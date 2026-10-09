import type { ComplianceItem, ComplianceItemInput, Dashboard, Me } from "./types.ts";
import type { GosiRate, GosiSystem, LaborTaskKind, Nationality, qiwaIndicators } from "./labor.ts";
import type { TaxKind } from "./tax.ts";
import type { DeductionKind, LeavePolicy, LeaveType } from "./hr.ts";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface Session {
  token: string;
  orgId?: string;
}

/** عميل الواجهة الخلفية. كل طلب لمنشأة يحمل X-Org-Id، والخادم يتحقق من العضوية داخل معاملة RLS. */
export function createApi(
  baseUrl: string,
  getSession: () => Session | null,
  onUnauthorized?: () => void,
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = (url, init) => fetch(url, init),
) {
  async function req<T>(path: string, init: RequestInit & { org?: boolean } = {}): Promise<T> {
    const s = getSession();
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    if (s?.token) headers.set("Authorization", `Bearer ${s.token}`);
    if (init.org !== false && s?.orgId) headers.set("X-Org-Id", s.orgId);

    const res = await fetchImpl(`${baseUrl}/v1${path}`, { ...init, headers });
    if (res.status === 401) onUnauthorized?.();
    if (!res.ok) {
      let detail = `تعذّر إكمال الطلب (${res.status})`;
      try {
        const body = await res.json();
        if (typeof body?.detail === "string") detail = body.detail;
        else if (Array.isArray(body?.detail)) detail = body.detail.map((d: { msg: string }) => d.msg).join("، ");
      } catch { /* الاستجابة ليست JSON */ }
      throw new ApiError(res.status, detail);
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  const post = <T = unknown>(path: string, body: unknown) =>
    req<T>(path, { method: "POST", org: false, body: JSON.stringify(body) });

  /** تنزيل ملف بالتوكن (الروابط العادية لا تحمل ترويسة الدخول). */
  async function reqBlob(path: string, org: boolean): Promise<Blob> {
    const s = getSession();
    const headers = new Headers();
    if (s?.token) headers.set("Authorization", `Bearer ${s.token}`);
    if (org && s?.orgId) headers.set("X-Org-Id", s.orgId);
    const res = await fetchImpl(`${baseUrl}/v1${path}`, { headers });
    if (!res.ok) throw new ApiError(res.status, "تعذّر تنزيل الملف");
    return res.blob();
  }

  return {
    login: (email: string, password: string) =>
      req<{ access_token: string; must_change_password: boolean }>("/auth/login", { method: "POST", org: false, body: JSON.stringify({ email, password }) }),
    changePassword: (current_password: string, new_password: string) =>
      req<void>("/auth/change-password", { method: "POST", org: false, body: JSON.stringify({ current_password, new_password }) }),
    me: () => req<Me>("/auth/me", { org: false }),

    billingOverview: () => req<BillingOverview>("/billing/overview"),

    // ---------- العمل والموظفين
    laborOverview: () => req<LaborOverview>("/labor/overview"),
    setLaborProfile: (b: LaborProfile) => req<{ ok: boolean }>("/labor/profile", { method: "PUT", body: JSON.stringify(b) }),
    laborTaskDone: (id: string, b: { reference: string | null; amount?: number | null }) =>
      req<{ ok: boolean }>(`/labor/tasks/${id}/done`, { method: "POST", body: JSON.stringify(b) }),
    laborTaskReopen: (id: string) => req<{ ok: boolean }>(`/labor/tasks/${id}/reopen`, { method: "POST", body: "{}" }),
    employees: () => req<{ employees: Employee[]; show_wages: boolean }>("/labor/employees"),
    createEmployee: (b: EmployeeInput) => req<{ id: string }>("/labor/employees", { method: "POST", body: JSON.stringify(b) }),
    updateEmployee: (id: string, b: EmployeeInput) => req<{ ok: boolean }>(`/labor/employees/${id}`, { method: "PUT", body: JSON.stringify(b) }),
    importEmployees: (employees: EmployeeInput[]) =>
      req<{ imported: number }>("/labor/employees/bulk", { method: "POST", body: JSON.stringify({ employees }) }),
    employeeLeave: (id: string, left_on: string) =>
      req<{ ok: boolean }>(`/labor/employees/${id}/leave`, { method: "POST", body: JSON.stringify({ left_on }) }),
    gosiMonth: (month?: string) => req<GosiMonth>(`/labor/gosi${month ? `?month=${month}` : ""}`),
    gosiCalc: (b: { nationality: string; gosi_system: string; basic_wage: number; housing_allowance: number; on?: string | null }) =>
      req<GosiCalcResult>("/labor/calculator", { method: "POST", body: JSON.stringify(b) }),
    gosiRates: () => req<GosiRate[]>("/labor/rates"),
    dashboard: () => req<Dashboard>("/dashboard"),
    listItems: () => req<ComplianceItem[]>("/compliance-items"),
    createItem: (body: ComplianceItemInput) =>
      req<ComplianceItem>("/compliance-items", { method: "POST", body: JSON.stringify(body) }),
    renewItem: (id: string, new_expiry_date: string) =>
      req<ComplianceItem>(`/compliance-items/${id}/renew`, { method: "POST", body: JSON.stringify({ new_expiry_date }) }),
    archiveItem: (id: string) => req<void>(`/compliance-items/${id}`, { method: "DELETE" }),
    remindNow: (id: string) =>
      req<{ queued: number; message: string }>(`/compliance-items/${id}/remind`, { method: "POST" }),

    // ---------- الحوكمة والهيكل
    governance: () => req<GovernanceStructure>("/governance/structure"),
    applyTemplate: () => req<{ bodies_added: number }>("/governance/structure/apply-template", { method: "POST" }),
    applyExample: () => req<{ bodies: number }>("/governance/structure/apply-example", { method: "POST" }),
    updateProfile: (b: GovernanceProfile) => req<GovernanceProfile>("/governance/profile", { method: "PUT", body: JSON.stringify(b) }),
    addBody: (b: BodyInput) => req<{ id: string }>("/governance/bodies", { method: "POST", body: JSON.stringify(b) }),
    updateBody: (id: string, b: BodyInput) => req<{ updated: boolean }>(`/governance/bodies/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
    deleteBody: (id: string) => req<void>(`/governance/bodies/${id}`, { method: "DELETE" }),
    addMember: (bodyId: string, b: MemberInput) =>
      req<{ id: string }>(`/governance/bodies/${bodyId}/members`, { method: "POST", body: JSON.stringify(b) }),
    updateMember: (id: string, b: MemberInput) => req<{ updated: boolean }>(`/governance/members/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
    deleteMember: (id: string) => req<void>(`/governance/members/${id}`, { method: "DELETE" }),
    runCheck: () => req<CheckRun>("/governance/check", { method: "POST" }),

    // ---------- حماية البيانات الشخصية
    pdplSummary: () => req<PdplOverview>("/pdpl/summary"),
    ropa: () => req<RopaRecord[]>("/pdpl/records"),
    ropaOwners: () => req<{ id: string; full_name: string; role: string }[]>("/pdpl/owners"),
    ropaTemplates: () => req<{ key: string; activity_name: string; data_subjects: string }[]>("/pdpl/record-templates"),
    addRopa: (b: RopaInput) => req<{ id: string }>("/pdpl/records", { method: "POST", body: JSON.stringify(b) }),
    addRopaFromTemplate: (key: string) => req<{ id: string }>(`/pdpl/records/from-template/${key}`, { method: "POST" }),
    updateRopa: (id: string, b: RopaInput) => req<{ updated: boolean }>(`/pdpl/records/${id}`, { method: "PUT", body: JSON.stringify(b) }),
    deleteRopa: (id: string) => req<void>(`/pdpl/records/${id}`, { method: "DELETE" }),
    dsr: () => req<DataRequest[]>("/pdpl/requests"),
    addDsr: (b: DataRequestInput) => req<{ id: string; due_on: string }>("/pdpl/requests", { method: "POST", body: JSON.stringify(b) }),
    updateDsr: (id: string, b: { status: string; identity_verified: boolean; response_note: string | null }) =>
      req<{ updated: boolean }>(`/pdpl/requests/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
    incidents: () => req<Incident[]>("/pdpl/incidents"),
    addIncident: (b: IncidentInput) => req<{ id: string }>("/pdpl/incidents", { method: "POST", body: JSON.stringify(b) }),
    updateIncident: (id: string, b: Record<string, unknown>) =>
      req<{ updated: boolean }>(`/pdpl/incidents/${id}`, { method: "PATCH", body: JSON.stringify(b) }),

    // ---------- طلب تجربة (عام، بلا دخول)
    // ---------- التسجيل الذاتي والإعداد
    publicPricing: () => req<PublicPricing>("/public/pricing", { org: false }),
    signup: (b: SignupInput) => req<{ access_token: string; org_id: string; trial_days: number }>("/public/signup", { method: "POST", org: false, body: JSON.stringify(b) }),
    verifyEmail: (token: string) => req<{ verified: boolean }>("/public/verify-email", { method: "POST", org: false, body: JSON.stringify({ token }) }),
    resendVerification: () => req<{ sent?: boolean; verified?: boolean }>("/auth/resend-verification", { method: "POST", org: false, body: "{}" }),
    onboarding: () => req<OnboardingState>("/onboarding"),
    completeOnboarding: (b: OnboardingInput) => req<{ ok: boolean }>("/onboarding", { method: "POST", body: JSON.stringify(b) }),

    // ---------- الدفع الإلكتروني
    checkoutOptions: () => req<CheckoutOptions>("/billing/checkout/options"),
    checkout: (b: { purpose: "SUBSCRIPTION" | "INSTALLMENT" | "ADDON"; plan_tier?: string; billing_cycle?: "MONTHLY" | "YEARLY"; installment_id?: string; addon_code?: string }) =>
      req<{ intent_id: string; checkout_url: string; total: number }>("/billing/checkout", { method: "POST", body: JSON.stringify(b) }),
    checkoutStatus: (id: string) => req<PaymentIntent>(`/billing/checkout/${id}`),
    sandboxPay: (id: string) => req<PaymentIntent>(`/billing/checkout/${id}/sandbox-pay`, { method: "POST", body: "{}" }),
    myPayments: () => req<PaymentIntent[]>("/billing/payments"),

    // ---------- الزكاة والضريبة
    taxOverview: () => req<TaxOverview>("/tax/overview"),
    setTaxProfile: (b: TaxProfile) => req<{ ok: boolean }>("/tax/profile", { method: "PUT", body: JSON.stringify(b) }),
    taxDone: (id: string, b: { reference: string | null; amount?: number | null }) => req<{ ok: boolean }>(`/tax/tasks/${id}/done`, { method: "POST", body: JSON.stringify(b) }),
    taxReopen: (id: string) => req<{ ok: boolean }>(`/tax/tasks/${id}/reopen`, { method: "POST", body: "{}" }),

    // ---------- مزامنة التقويم
    calendarFeed: () => req<{ active: boolean; include_people?: boolean; created_at?: string; can_manage: boolean }>("/calendar/feed"),
    createCalendarFeed: (include_people: boolean) => req<{ url: string; include_people: boolean; ics?: string }>("/calendar/feed", { method: "POST", body: JSON.stringify({ include_people }) }),
    deleteCalendarFeed: () => req<void>("/calendar/feed", { method: "DELETE" }),

    // ---------- بوت الموظفين
    botOverview: () => req<BotOverview>("/bot/overview"),
    botSettings: (b: { enabled: boolean; welcome_text: string | null; hr_contact: string | null; require_approval: boolean }) =>
      req<{ ok: boolean }>("/bot/settings", { method: "PUT", body: JSON.stringify(b) }),
    botRotateCode: () => req<{ invite_code: string }>("/bot/invite-code/rotate", { method: "POST", body: "{}" }),
    botAddMember: (b: { full_name: string; phone: string; employee_id?: string | null }) => req<{ id: string }>("/bot/members", { method: "POST", body: JSON.stringify(b) }),
    botApprove: (id: string) => req<{ ok: boolean }>(`/bot/members/${id}/approve`, { method: "POST", body: "{}" }),
    botRemove: (id: string) => req<void>(`/bot/members/${id}`, { method: "DELETE" }),
    botAddFaq: (b: { question: string; answer: string; is_active?: boolean }) => req<{ id: string }>("/bot/faqs", { method: "POST", body: JSON.stringify(b) }),
    botEditFaq: (id: string, b: { question: string; answer: string; is_active: boolean }) => req<{ ok: boolean }>(`/bot/faqs/${id}`, { method: "PUT", body: JSON.stringify(b) }),
    botDeleteFaq: (id: string) => req<void>(`/bot/faqs/${id}`, { method: "DELETE" }),
    botSharePolicy: (id: string, b: { shared: boolean; employee_summary: string | null }) => req<{ ok: boolean }>(`/bot/policies/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
    botSimulate: (text: string, member_id?: string | null) => req<{ reply: string; intent: string; sources: { kind: string; title: string }[] }>("/bot/simulate", { method: "POST", body: JSON.stringify({ text, member_id: member_id ?? null }) }),
    botAcks: () => req<{ policy_id: string; title: string; version: string; member_id: string; full_name: string; acknowledged_at: string | null }[]>("/bot/acknowledgments"),

    // ---------- الحضور بالموقع وبصمة الجوال
    attendanceOverview: () => req<AttendanceOverview>("/attendance/overview"),
    attendanceSettings: (b: AttendanceSettings) => req<{ ok: boolean }>("/attendance/settings", { method: "PUT", body: JSON.stringify(b) }),
    addSite: (b: SiteInput) => req<{ id: string }>("/attendance/sites", { method: "POST", body: JSON.stringify(b) }),
    editSite: (id: string, b: SiteInput) => req<{ ok: boolean }>(`/attendance/sites/${id}`, { method: "PUT", body: JSON.stringify(b) }),
    deleteSite: (id: string) => req<void>(`/attendance/sites/${id}`, { method: "DELETE" }),
    attendanceLink: (employeeId: string) => req<{ url: string }>(`/attendance/people/${employeeId}/link`, { method: "POST", body: "{}" }),
    revokeDevice: (employeeId: string) => req<void>(`/attendance/people/${employeeId}/device`, { method: "DELETE" }),
    attendanceReport: (month: string) => req<AttendanceReport>(`/attendance/report?month=${month}`),
    attendPage: (token: string) => req<AttendPage>(`/public/attendance/${encodeURIComponent(token)}`, { org: false }),
    attendEnroll: (token: string, b: { challenge: string; credential_id?: string; client_data_json: string; attestation_object: string; label?: string | null }) =>
      req<{ enrolled: boolean }>(`/public/attendance/${encodeURIComponent(token)}/enroll`, { method: "POST", org: false, body: JSON.stringify(b) }),
    attendCheck: (token: string, b: AttendCheckInput) =>
      req<AttendCheckResult>(`/public/attendance/${encodeURIComponent(token)}/check`, { method: "POST", org: false, body: JSON.stringify(b) }),
    botLinkMember: (id: string, employee_id: string | null) => req<{ ok: boolean }>(`/bot/members/${id}`, { method: "PATCH", body: JSON.stringify({ employee_id }) }),

    // ---------- الموارد البشرية: الإجازات والمباشرة والخصومات
    hrOverview: () => req<HrOverview>("/hr/overview"),
    hrSettings: (b: HrSettings) => req<{ ok: boolean }>("/hr/settings", { method: "PUT", body: JSON.stringify(b) }),
    hrPolicy: (type: LeaveType, b: LeavePolicy) => req<{ ok: boolean }>(`/hr/policies/${type}`, { method: "PUT", body: JSON.stringify(b) }),
    hrAddLeave: (b: { employee_id: string; leave_type: LeaveType; start_date: string; end_date: string; reason?: string | null; medical_ref?: string | null; approve: boolean }) =>
      req<{ id: string; days: number; status: string; pay_note?: string }>("/hr/leaves", { method: "POST", body: JSON.stringify(b) }),
    hrDecideLeave: (id: string, b: { approve: boolean; note?: string | null }) => req<{ status: string }>(`/hr/leaves/${id}/decide`, { method: "POST", body: JSON.stringify(b) }),
    hrCancelLeave: (id: string) => req<{ ok: boolean }>(`/hr/leaves/${id}/cancel`, { method: "POST", body: "{}" }),
    hrConfirmReturn: (id: string, return_date: string) => req<{ late_days: number }>(`/hr/leaves/${id}/return`, { method: "POST", body: JSON.stringify({ return_date }) }),
    hrAdjust: (employeeId: string, b: { days: number; note: string }) => req<{ ok: boolean }>(`/hr/employees/${employeeId}/adjust`, { method: "POST", body: JSON.stringify(b) }),
    hrDeductions: (month: string) => req<HrDeductions>(`/hr/deductions?month=${month}`),
    hrAddNotice: (b: { employee_id: string; kind: DeductionKind; incident_date: string; description: string; amount: number; payroll_month: string; leave_request_id?: string | null }) =>
      req<{ id: string }>("/hr/deductions", { method: "POST", body: JSON.stringify(b) }),
    hrDecideNotice: (id: string, b: { confirm: boolean; note?: string | null }) => req<{ ok: boolean }>(`/hr/deductions/${id}/decide`, { method: "POST", body: JSON.stringify(b) }),
    personHr: (token: string) => req<PersonHr>(`/public/attendance/${encodeURIComponent(token)}/hr`, { org: false }),
    personLeave: (token: string, b: { leave_type: LeaveType; start_date: string; end_date: string; reason?: string | null; medical_ref?: string | null }) =>
      req<{ id: string; days: number; status: string; pay_note?: string }>(`/public/attendance/${encodeURIComponent(token)}/leaves`, { method: "POST", org: false, body: JSON.stringify(b) }),
    personCancelLeave: (token: string, id: string) => req<{ ok: boolean }>(`/public/attendance/${encodeURIComponent(token)}/leaves/${id}/cancel`, { method: "POST", org: false, body: "{}" }),
    personReturn: (token: string, id: string, return_date: string) =>
      req<{ late_days: number }>(`/public/attendance/${encodeURIComponent(token)}/leaves/${id}/return`, { method: "POST", org: false, body: JSON.stringify({ return_date }) }),
    personObject: (token: string, id: string, objection: string) =>
      req<{ ok: boolean }>(`/public/attendance/${encodeURIComponent(token)}/notices/${id}/object`, { method: "POST", org: false, body: JSON.stringify({ objection }) }),

    // ---------- تقويم المناسبات
    events: () => req<EventsView>("/events"),
    eventsSettings: (b: { enabled: boolean; signature: string | null; excluded_codes: string[] }) => req<{ ok: boolean }>("/events/settings", { method: "PUT", body: JSON.stringify(b) }),

    submitTrial: (b: TrialInput) => req<{ received: boolean }>("/public/trial-requests", { method: "POST", org: false, body: JSON.stringify(b) }),

    // ---------- تقييم الأثر (DPIA)
    dpiaQuestionnaire: () => req<DpiaQuestionnaire>("/pdpl/dpia/questionnaire"),
    dpiaList: () => req<Dpia[]>("/pdpl/dpia"),
    dpia: (id: string) => req<Dpia>(`/pdpl/dpia/${id}`),
    addDpia: (b: DpiaInput) => req<Dpia>("/pdpl/dpia", { method: "POST", body: JSON.stringify(b) }),
    updateDpia: (id: string, b: DpiaInput) => req<Dpia>(`/pdpl/dpia/${id}`, { method: "PUT", body: JSON.stringify(b) }),
    dpiaStatus: (id: string, status: Dpia["status"]) =>
      req<Dpia>(`/pdpl/dpia/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }),
    deleteDpia: (id: string) => req<void>(`/pdpl/dpia/${id}`, { method: "DELETE" }),

    // ---------- المنشآت المتعددة وتقرير المجلس
    group: () => req<GroupOverview>("/group"),
    addGroupEntity: (b: GroupEntityInput) => req<{ id: string }>("/group/entities", { method: "POST", body: JSON.stringify(b) }),
    boardReport: (year: number) => req<BoardReportResponse>(`/reports/board?year=${year}`),
    saveBoardReport: (year: number, notes: string | null) =>
      req<{ saved: boolean }>(`/reports/board/${year}`, { method: "PUT", body: JSON.stringify({ notes }) }),

    // ---------- التنبيهات
    alertsOverview: () => req<AlertsOverview>("/alerts/overview"),
    setAlertRule: (b: { target_type: AlertTargetType; target_id: null; days_before: number[]; channels: string[]; is_enabled: boolean }) =>
      req<{ id: string }>("/alert-rules", { method: "PUT", body: JSON.stringify(b) }),
    setRecipient: (membershipId: string, b: { receives_alerts: boolean; alert_channels: ("WHATSAPP" | "EMAIL")[] }) =>
      req<{ updated: boolean }>(`/alerts/recipients/${membershipId}`, { method: "PATCH", body: JSON.stringify(b) }),

    // ---------- الاستشارات القانونية
    legalRates: () => req<LegalRatesInfo>("/legal/rates"),
    legalQuote: (b: { topic: string; duration_minutes: number; urgent: boolean }) =>
      req<LegalQuote>("/legal/quote", { method: "POST", body: JSON.stringify(b) }),
    legalBook: (b: LegalBookInput) => req<{ id: string; total_sar: number }>("/legal/consultations", { method: "POST", body: JSON.stringify(b) }),
    legalMine: () => req<Consultation[]>("/legal/consultations"),
    legalCancel: (id: string, reason: string) =>
      req<{ status: string }>(`/legal/consultations/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }),

    // ---------- الالتزامات
    obligations: () => req<Obligation[]>("/obligations"),
    setObligation: (code: string, status: ObligationStatus, note?: string | null) =>
      req<{ updated: boolean }>(`/obligations/${code}`, { method: "PATCH", body: JSON.stringify({ status, note: note ?? null }) }),

    // ---------- المكتبة والسياسات
    library: () => req<LibraryDoc[]>("/library"),
    libraryDoc: (id: string) => req<LibraryDoc & { body_md: string | null }>(`/library/${id}`),
    libraryFile: (id: string) => reqBlob(`/library/${id}/file`, true),
    adopt: (id: string) => req<{ policy_id: string }>(`/library/${id}/adopt`, { method: "POST" }),
    policies: () => req<Policy[]>("/policies"),
    policy: (id: string) => req<Policy & { body_md: string | null; source_library_id: string | null }>(`/policies/${id}`),
    updatePolicy: (id: string, b: { title: string; body_md: string | null; version: string }) =>
      req<{ updated: boolean }>(`/policies/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
    approvePolicy: (id: string, review_months = 12) =>
      req<{ status: string }>(`/policies/${id}/approve`, { method: "POST", body: JSON.stringify({ review_months }) }),

    admin: {
      events: () => req<{ events: AnnualEvent[]; orgs_enabled: number }>("/admin/events", { org: false }),
      addEvent: (b: AnnualEventInput) => req<{ id: string }>("/admin/events", { method: "POST", org: false, body: JSON.stringify(b) }),
      editEvent: (id: string, b: AnnualEventInput) => req<{ ok: boolean }>(`/admin/events/${id}`, { method: "PUT", org: false, body: JSON.stringify(b) }),
      pricing: () => req<PublicPricing>("/admin/pricing", { org: false }),
      setPlanPrice: (tier: string, b: { monthly_price_sar: number; yearly_price_sar: number; monthly_whatsapp_alerts: number | null }) =>
        req<{ ok: boolean }>(`/admin/pricing/plans/${tier}`, { method: "PUT", org: false, body: JSON.stringify(b) }),
      setAddon: (code: string, b: { monthly_price: number; included_tiers: string[]; members: number | null; questions: number | null; included_unlimited: boolean; is_active: boolean }) =>
        req<{ ok: boolean }>(`/admin/pricing/addons/${code}`, { method: "PUT", org: false, body: JSON.stringify(b) }),
      gosiRates: () => req<(GosiRate & { id: number; updated_at: string })[]>("/admin/gosi-rates", { org: false }),
      setGosiRate: (b: GosiRate) => req<{ id: number }>("/admin/gosi-rates", { method: "PUT", org: false, body: JSON.stringify(b) }),
      overview: () => req<AdminOverview>("/admin/overview", { org: false }),
      organizations: () => req<AdminOrg[]>("/admin/organizations", { org: false }),
      dispatches: (status?: string) =>
        req<AdminDispatches>(`/admin/dispatches${status ? `?status=${encodeURIComponent(status)}` : ""}`, { org: false }),
      aiUsage: () => req<AdminUsage[]>("/admin/ai-usage", { org: false }),

      me: () => req<AdminMe>("/admin/me", { org: false }),
      orgDetail: (id: string) => req<AdminOrgDetail>(`/admin/organizations/${id}`, { org: false }),
      createOrg: (b: CreateOrgInput) => post<CreateOrgResult>("/admin/organizations", b),
      updateOrg: (id: string, b: Partial<Pick<AdminOrg, "name" | "industry_type">> & { entity_legal_type?: string; commercial_size?: string }) =>
        req<{ updated: boolean }>(`/admin/organizations/${id}`, { method: "PATCH", org: false, body: JSON.stringify(b) }),
      suspend: (id: string, reason: string) => post(`/admin/organizations/${id}/suspend`, { reason }),
      reactivate: (id: string, reason: string) => post(`/admin/organizations/${id}/reactivate`, { reason }),
      changePlan: (id: string, plan_tier: string, note?: string) => post(`/admin/organizations/${id}/subscription/change-plan`, { plan_tier, note }),
      extendTrial: (id: string, days: number) => post(`/admin/organizations/${id}/subscription/extend-trial`, { days }),
      recordPayment: (id: string, b: { amount_sar: number; billing_cycle: "MONTHLY" | "YEARLY"; plan_tier?: string; reference?: string; note?: string }) =>
        post(`/admin/organizations/${id}/subscription/payment`, b),
      cancelSubscription: (id: string, reason: string) => post(`/admin/organizations/${id}/subscription/cancel`, { reason }),
      inviteMember: (id: string, b: { email: string; full_name: string; phone_number?: string; role: string }) =>
        post<{ temporary_password: string | null; existing_user: boolean }>(`/admin/organizations/${id}/members`, b),
      updateMembership: (mid: string, b: { role?: string; is_active?: boolean }) =>
        req<{ updated: boolean }>(`/admin/memberships/${mid}`, { method: "PATCH", org: false, body: JSON.stringify(b) }),
      resetPassword: (uid: string) => post<{ temporary_password: string }>(`/admin/users/${uid}/reset-password`, {}),
      disableUser: (uid: string, reason: string) => post(`/admin/users/${uid}/disable`, { reason }),
      enableUser: (uid: string) => post(`/admin/users/${uid}/enable`, {}),
      team: () => req<TeamMember[]>("/admin/team", { org: false }),
      teamAdd: (b: { email: string; full_name: string; role: string }) => post<{ temporary_password: string | null }>("/admin/team", b),
      teamRole: (uid: string, role: string | null) =>
        req<{ role: string | null }>(`/admin/team/${uid}`, { method: "PATCH", org: false, body: JSON.stringify({ role }) }),
      roles: () => req<AdminRolesResponse>("/admin/roles", { org: false }),
      createRole: (b: AdminRoleInput & { code?: string }) => post<{ code: string }>("/admin/roles", b),
      updateRole: (code: string, b: AdminRoleInput) =>
        req<{ updated: boolean }>(`/admin/roles/${code}`, { method: "PATCH", org: false, body: JSON.stringify(b) }),
      deleteRole: (code: string) => req<{ deleted: boolean }>(`/admin/roles/${code}`, { method: "DELETE", org: false }),
      audit: (orgId?: string) => req<AuditEntry[]>(`/admin/audit${orgId ? `?org_id=${orgId}` : ""}`, { org: false }),

      // المحتوى المرجعي
      standards: () => req<AdminStandard[]>("/admin/catalog/standards", { org: false }),
      patchStandard: (code: string, b: Partial<AdminStandard>) =>
        req<{ updated: boolean }>(`/admin/catalog/standards/${code}`, { method: "PATCH", org: false, body: JSON.stringify(b) }),
      catalogObligations: () => req<AdminObligation[]>("/admin/catalog/obligations", { org: false }),
      createObligation: (b: Record<string, unknown>) => post<{ code: string }>("/admin/catalog/obligations", b),
      patchObligation: (code: string, b: Record<string, unknown>) =>
        req<{ updated: boolean }>(`/admin/catalog/obligations/${code}`, { method: "PATCH", org: false, body: JSON.stringify(b) }),
      libraryAll: () => req<AdminLibraryDoc[]>("/admin/library", { org: false }),
      libraryDoc: (id: string) => req<AdminLibraryDoc & { body_md: string | null }>(`/admin/library/${id}`, { org: false }),
      libraryFile: (id: string) => reqBlob(`/admin/library/${id}/file`, false),
      createDoc: (b: Record<string, unknown>) => post<{ id: string }>("/admin/library", b),
      patchDoc: (id: string, b: Record<string, unknown>) =>
        req<{ updated: boolean }>(`/admin/library/${id}`, { method: "PATCH", org: false, body: JSON.stringify(b) }),
      deleteDoc: (id: string) => req<void>(`/admin/library/${id}`, { method: "DELETE", org: false }),
      legalConsultations: () => req<AdminConsultation[]>("/admin/legal/consultations", { org: false }),
      // المالية الداخلية لحصيف
      finSummary: (period: string) => req<FinanceSummary>(`/admin/finance/summary?period=${encodeURIComponent(period)}`, { org: false }),
      invoices: (period?: string, q?: string, cycle?: string) => {
        const p = new URLSearchParams(); if (period) p.set("period", period); if (q) p.set("q", q); if (cycle) p.set("cycle", cycle);
        const qs = p.toString();
        return req<InvoiceRow[]>(`/admin/finance/invoices${qs ? `?${qs}` : ""}`, { org: false });
      },
      invoice: (id: string) => req<Invoice>(`/admin/finance/invoices/${id}`, { org: false }),
      voidInvoice: (id: string, reason: string) => post<{ credit_note: { id: string; number: string } }>(`/admin/finance/invoices/${id}/void`, { reason }),
      expenses: (period?: string, frequency?: string) => {
        const p = new URLSearchParams(); if (period) p.set("period", period); if (frequency) p.set("frequency", frequency);
        const qs = p.toString();
        return req<Expense[]>(`/admin/finance/expenses${qs ? `?${qs}` : ""}`, { org: false });
      },
      statement: (view: "monthly" | "yearly", year: number, allocate: boolean) =>
        req<FinanceStatement>(`/admin/finance/statement?view=${view}&year=${year}&allocate=${allocate}${view === "yearly" ? "&years=4" : ""}`, { org: false }),
      addExpense: (b: ExpenseInput) => post<{ id: string }>("/admin/finance/expenses", b),
      updateExpense: (id: string, b: ExpenseInput) =>
        req<{ updated: boolean }>(`/admin/finance/expenses/${id}`, { method: "PATCH", org: false, body: JSON.stringify(b) }),
      deleteExpense: (id: string) => req<{ deleted: boolean }>(`/admin/finance/expenses/${id}`, { method: "DELETE", org: false }),
      vatReturn: (period: string) => req<VatReturn>(`/admin/finance/vat?period=${encodeURIComponent(period)}`, { org: false }),
      plans: (status?: string, orgId?: string) => {
        const p = new URLSearchParams(); if (status) p.set("status", status); if (orgId) p.set("org_id", orgId);
        const qs = p.toString();
        return req<PaymentPlan[]>(`/admin/finance/plans${qs ? `?${qs}` : ""}`, { org: false });
      },
      plan: (id: string) => req<PaymentPlanDetail>(`/admin/finance/plans/${id}`, { org: false }),
      createPlan: (b: PaymentPlanInput) => post<{ id: string; invoice: { id: string; number: string } | null }>("/admin/finance/plans", b),
      payInstallment: (planId: string, instId: string, reference: string | null) =>
        post<{ invoice: { id: string; number: string } }>(`/admin/finance/plans/${planId}/installments/${instId}/pay`, { reference }),
      remindInstallment: (planId: string, instId: string) => post<{ sent: number }>(`/admin/finance/plans/${planId}/installments/${instId}/remind`, {}),
      cancelPlan: (id: string, reason: string) => post<{ status: string }>(`/admin/finance/plans/${id}/cancel`, { reason }),
      finProfile: () => req<HaseefProfile>("/admin/finance/profile", { org: false }),
      saveFinProfile: (b: HaseefProfile) =>
        req<{ updated: boolean }>("/admin/finance/profile", { method: "PUT", org: false, body: JSON.stringify(b) }),
      trials: () => req<TrialRequest[]>("/admin/trial-requests", { org: false }),
      updateTrial: (id: string, b: { status: TrialRequest["status"]; notes: string | null }) =>
        req<{ updated: boolean }>(`/admin/trial-requests/${id}`, { method: "PATCH", org: false, body: JSON.stringify(b) }),
      legalAssign: (id: string, b: { lawyer_id: string; scheduled_at: string; meeting_link: string | null }) =>
        post(`/admin/legal/consultations/${id}/assign`, b),
      legalComplete: (id: string, lawyer_summary: string | null) => post(`/admin/legal/consultations/${id}/complete`, { lawyer_summary }),
      legalCancel: (id: string, reason: string) => post(`/admin/legal/consultations/${id}/cancel`, { reason }),
      legalPayment: (id: string, payment_status: "PAID" | "REFUNDED", payment_reference: string) =>
        post(`/admin/legal/consultations/${id}/payment`, { payment_status, payment_reference }),
      legalRates: () => req<(LegalRate & { is_active: boolean })[]>("/admin/legal/rates", { org: false }),
      legalSetRate: (topic: string, hourly_rate_sar: number, is_active: boolean) =>
        req<{ updated: boolean }>(`/admin/legal/rates/${topic}`, { method: "PATCH", org: false, body: JSON.stringify({ hourly_rate_sar, is_active }) }),
      lawyers: () => req<Lawyer[]>("/admin/legal/lawyers", { org: false }),
      addLawyer: (b: Omit<Lawyer, "id">) => post<{ id: string }>("/admin/legal/lawyers", b),
      updateLawyer: (id: string, b: Omit<Lawyer, "id">) =>
        req<{ updated: boolean }>(`/admin/legal/lawyers/${id}`, { method: "PATCH", org: false, body: JSON.stringify(b) }),
      orgGovernance: (id: string) => req<AdminOrgGovernance>(`/admin/organizations/${id}/governance`, { org: false }),
    },
  };
}

export type Api = ReturnType<typeof createApi>;

export interface AdminOverview {
  kpis: { active_orgs: number; trials: number; mrr_sar: number | null; avg_score: number | null };
  by_plan: { plan_tier: string; n: number }[];
  by_industry: { industry: string; n: number }[];
}
// ---------- المالية الداخلية لحصيف
export interface HaseefProfile {
  legal_name: string; trade_name: string; vat_registered: boolean; vat_number: string | null; cr_number: string | null;
  address: string | null; email: string | null; phone: string | null; iban: string | null; invoice_note: string | null;
}
export interface InvoiceLineRow { description: string; quantity: number; unit_price: number; net: number; vat: number; total: number }
export interface InvoiceRow {
  id: string; number: string; kind: "INVOICE" | "CREDIT_NOTE"; source: "SUBSCRIPTION" | "CONSULTATION" | "MANUAL";
  org_id: string | null; buyer_name: string; subtotal: number; vat_amount: number; total: number; issued_at: string;
  status: "ISSUED" | "VOID"; payment_reference: string | null; related_number: string | null; plan_cycle: "MONTHLY" | "YEARLY" | null;
}
export interface Invoice extends InvoiceRow {
  buyer_cr: string | null; buyer_vat: string | null; seller: HaseefProfile; lines: InvoiceLineRow[]; vat_rate: number;
  note: string | null; qr: string | null; void_reason: string | null; credit_note_number: string | null; credit_note_id: string | null;
}
export interface ExpenseInput {
  spent_on: string; category: string; vendor: string; description: string | null; net_amount: number; vat_amount: number;
  reference: string | null; frequency: "ONE_TIME" | "MONTHLY" | "YEARLY";
}
export interface Expense extends ExpenseInput { id: string; total: number; created_at: string; created_by_name: string | null }
export interface FinanceSummary {
  period: string; from: string; to: string;
  revenue: { total: number; by_source: { source: string; net: number; vat: number; invoices: number; credit_notes: number }[];
    by_cycle: { cycle: string; net: number; invoices: number }[] };
  mrr_split: { cycle: "MONTHLY" | "YEARLY"; subscribers: number; mrr: number }[];
  fixed_costs: { monthly: number; yearly_share: number; total: number };
  expenses: { total: number; by_category: { category: string; net: number; vat: number; n: number }[] };
  net_profit: number; margin: number | null;
  vat: { output: number; input: number; payable: number };
  monthly: { month: string; revenue: number; expenses: number }[];
  mrr: number;
  renewals_due: { org_id: string; name: string; plan_tier: string; billing_cycle: string; ends_at: string; expected: number }[];
  renewals_expected: number;
  installments_due: { id: string; plan_id: string; seq: number; installments: number; due_date: string; amount_net: number;
    org_id: string; name: string; overdue: boolean }[];
  installments_overdue_total: number;
}
export interface PaymentPlan {
  id: string; org_id: string; org_name: string; plan_tier: string; total_net: number; installments: number; starts_on: string; ends_on: string;
  status: "ACTIVE" | "COMPLETED" | "CANCELED"; note: string | null; created_at: string; paid_net: number; remaining_net: number;
  paid_count: number; next_due: string | null; overdue_count: number;
}
export interface Installment {
  id: string; seq: number; due_date: string; amount_net: number; paid_at: string | null; payment_reference: string | null;
  invoice_id?: string | null; invoice_number: string | null; last_reminder_at: string | null; reminders: number;
}
export interface PaymentPlanDetail extends PaymentPlan { items: Installment[] }
export interface PaymentPlanInput {
  org_id: string; plan_tier: string; installments: number; starts_on: string; total_net?: number | null; note?: string | null;
  pay_first?: boolean; first_reference?: string | null;
}
export interface BillingOverview {
  subscription: { plan_tier: string; billing_cycle: string; billing_status: string; starts_at: string; ends_at: string;
    monthly_price_sar: number; yearly_price_sar: number } | null;
  plan: PaymentPlanDetail | null; vat_rate: number;
  invoices: { id: string; number: string; kind: string; source: string; subtotal: number; vat_amount: number; total: number; issued_at: string; status: string }[];
}
export interface StatementRow { group: string; key: string; label: string; values: number[]; total: number }
export interface FinanceStatement {
  view: "monthly" | "yearly"; columns: string[]; allocate: boolean;
  revenue: StatementRow[]; revenue_total: StatementRow; expenses: StatementRow[]; expenses_total: StatementRow; net: StatementRow;
}
export interface VatReturn {
  period: string; from: string; to: string; file_by: string;
  sales: { sales: number; adjustments: number; vat: number }; purchases: { purchases: number; vat: number }; payable: number;
}

/** رمز دور فريق حصيف: الأدوار الأساسية الثلاثة أو أي دور مخصص ينشئه المدير. */
export type PlatformRole = "SUPER_ADMIN" | "SUPPORT" | "BILLING" | (string & {});
export interface AdminMe { user_id: string; role: PlatformRole; role_name: string; permissions: string[] }
export interface AdminPermission { code: string; name: string; group: string; description: string }
export interface AdminRole {
  code: string; name: string; description: string | null; permissions: string[]; is_system: boolean; members: number; updated_at: string;
}
export interface AdminRolesResponse { roles: AdminRole[]; permissions: AdminPermission[] }
export interface AdminRoleInput { name: string; description?: string | null; permissions: string[] }

export interface AdminOrg {
  id: string; name: string; cr_number: string; industry_type: string | null; haseef_score: number | null;
  suspended_at: string | null;
  plan_tier: string | null; billing_status: string | null; ends_at: string | null; members: number; created_at: string;
}
export interface AdminDispatch {
  id: string; org_name: string; target_type: string; channel: "WHATSAPP" | "EMAIL"; recipient_address: string;
  status: string; threshold_days: number; due_date: string; scheduled_for: string; sent_at: string | null;
  delivered_at: string | null; provider: string | null; attempts: number; last_error: string | null; skip_reason: string | null;
  kind: "AUTO" | "MANUAL";
}
export interface AdminDispatches {
  last_7_days: { status: string; channel: string; n: number }[];
  items: AdminDispatch[];
}
export interface AdminUsage {
  org_id: string; name: string; plan_tier: string | null; quota: number | null;
  audits_this_month: number; tokens: number; cost_sar: number | null;
}

export interface AdminMember {
  membership_id: string; role: string; membership_active: boolean; receives_alerts: boolean;
  user_id: string; full_name: string; email: string; phone_number: string | null; user_active: boolean;
  last_login_at: string | null; must_change_password: boolean; is_team_member: boolean;
}
export interface AdminOrgDetail {
  organization: {
    id: string; name: string; cr_number: string; entity_legal_type: string; industry_type: string | null;
    commercial_size: string | null; haseef_score: number | null; is_active: boolean;
    suspended_at: string | null; suspension_reason: string | null; created_at: string;
  };
  subscription: null | {
    id: string; plan_tier: string; billing_cycle: string; billing_status: string; starts_at: string; ends_at: string;
    monthly_price_sar: number; yearly_price_sar: number;
  };
  members: AdminMember[];
  billing: { event_type: string; plan_tier: string | null; amount_sar: number | null; period_months: number | null;
             reference: string | null; note: string | null; created_at: string; actor: string | null }[];
  counts: { items: number; expired: number; policies: number } | null;
  /** true لدور المحاسبة: بيانات الفوترة فقط */
  restricted?: boolean;
}
export interface CreateOrgInput {
  name: string; cr_number: string; entity_legal_type: string; industry_type?: string; commercial_size?: string;
  plan_tier: string; trial_days: number; admin_email: string; admin_full_name: string; admin_phone?: string;
}
export interface CreateOrgResult { id: string; temporary_password: string | null; admin_existing_user: boolean }
export interface TeamMember {
  id: string; full_name: string; email: string; platform_role: PlatformRole; role_name?: string | null; is_active: boolean;
  last_login_at: string | null; must_change_password: boolean;
}
export interface AuditEntry {
  id: number; created_at: string; action: string; entity_type: string; entity_id: string | null;
  changes: Record<string, unknown> | null; ip: string | null; actor: string | null; actor_role: string | null;
  org_name: string | null; org_id: string | null;
}

// ---------- الحوكمة والهيكل
export type BodyType =
  | "OWNER" | "GENERAL_ASSEMBLY" | "PARTNERS_ASSEMBLY" | "BOARD" | "MANAGER" | "EXECUTIVE_MANAGEMENT"
  | "AUDIT_COMMITTEE" | "NOMINATION_REMUNERATION_COMMITTEE" | "RISK_COMMITTEE" | "EXECUTIVE_COMMITTEE"
  | "OTHER_COMMITTEE" | "COMPANY_SECRETARY" | "INTERNAL_AUDIT" | "COMPLIANCE_FUNCTION" | "DPO";
export type MemberPosition = "CHAIR" | "VICE_CHAIR" | "MEMBER" | "SECRETARY" | "HEAD";
export interface GovernanceProfile {
  employees_count: number | null; fiscal_year_end_month: number; processes_personal_data: boolean;
  vat_registered: boolean | null; has_bylaws: boolean; bylaws_updated_on: string | null;
  auditor_name: string | null; auditor_appointed_on: string | null; beneficial_owners_filed_on: string | null;
  last_assembly_on: string | null; last_fs_filed_on: string | null;
  template_applied_at?: string | null; updated_at?: string;
}
export interface BodyMember {
  id: string; full_name: string; position: MemberPosition; is_independent: boolean; is_executive: boolean;
  appointed_on: string | null; term_ends_on: string | null;
}
export type MemberInput = Omit<BodyMember, "id">;
export interface GovBody {
  id: string; body_type: BodyType; name: string; mandate: string | null; meetings_per_year: number | null;
  sort: number; from_template: boolean; members: BodyMember[];
}
export type BodyInput = Pick<GovBody, "body_type" | "name" | "mandate" | "meetings_per_year">;
export interface CheckResult {
  code: string; status: "PASS" | "FAIL" | "NA"; message: string; level: "MANDATORY" | "RECOMMENDED";
  severity: "critical" | "high" | "medium"; title: string; domain: string; description: string;
  legal_reference: string | null; source_url: string | null; review_status: ReviewStatus;
}
export interface CheckRun {
  id: string; created_at: string; passed: number; failed: number; not_applicable: number;
  structure_score: number | null; results: CheckResult[];
}
export interface GovernanceStructure {
  legal_type: string; size: string | null; profile: GovernanceProfile; bodies: GovBody[]; latest_check: CheckRun | null;
  example_title: string | null;
}

// ---------- الالتزامات
export type ReviewStatus = "DRAFT" | "APPROVED";
export type ObligationStatus = "PENDING" | "IN_PLACE" | "NOT_APPLICABLE";
export interface Obligation {
  code: string; kind: "LICENSE" | "REGISTRATION" | "FILING" | "POLICY" | "PRACTICE"; domain: string;
  title: string; description: string; authority: string | null; legal_reference: string | null; source_url: string | null;
  frequency: string; risk_level: "CRITICAL" | "HIGH" | "MEDIUM"; compliance_category: string | null; policy_type: string | null;
  review_status: ReviewStatus; status: ObligationStatus; source: "AUTO" | "MANUAL"; note: string | null;
  needs_confirmation: boolean; tracked: null | { type: "ITEM" | "POLICY"; title?: string; status?: string; expiry_date?: string };
  effective_status: ObligationStatus | "AT_RISK";
}

// ---------- المكتبة والسياسات
export interface LibraryDoc {
  id: string; kind: "TEMPLATE" | "LAW" | "GUIDE" | "FILE"; category: string; title: string; summary: string | null;
  url: string | null; file_name: string | null; file_mime: string | null; file_size: number | null;
  policy_type: string | null; applies_legal_types: string[]; related_codes: string[]; review_status: ReviewStatus;
  version: string; updated_at: string; adopted?: boolean;
}
export interface Policy {
  id: string; policy_type: string; title: string; version: string; approval_date: string | null;
  review_due_date: string; status: "DRAFT" | "ACTIVE" | "OBSOLETE"; effective_status: string; days_remaining: number;
}

// ---------- إدارة المحتوى
export interface AdminStandard {
  code: string; domain: string; title: string; description: string; legal_reference: string | null; source_url: string | null;
  level: "MANDATORY" | "RECOMMENDED"; severity: "critical" | "high" | "medium"; applies_legal_types: string[];
  rule: Record<string, unknown>; is_visible: boolean; review_status: ReviewStatus; sort: number; updated_at: string;
}
export interface AdminObligation {
  code: string; kind: string; domain: string; title: string; description: string; authority: string | null;
  legal_reference: string | null; source_url: string | null; frequency: string; risk_level: string;
  applies: Record<string, unknown>; is_visible: boolean; review_status: ReviewStatus; orgs: number; updated_at: string;
}
export interface AdminLibraryDoc extends LibraryDoc {
  slug: string | null; is_visible: boolean; min_plan: string | null; created_at: string;
  created_by_name: string | null; updated_by_name: string | null; adoptions: number;
}
export interface AdminOrgGovernance {
  bodies: GovBody[]; latest_check: CheckRun | null;
  pdpl: { records: number; requests_open: number; requests_overdue: number; incidents_open: number; incidents_notify_overdue: number };
  obligations: { total: number; in_place: number; pending: number };
}

// ---------- حماية البيانات الشخصية
export interface RopaInput {
  activity_name: string; purpose: string; data_subjects: string; data_categories: string[]; includes_sensitive_data: boolean;
  legal_basis: string; owner_membership_id: string | null; retention_period_months: number; storage_location: string;
  cross_border_transfer: boolean; transfer_destination: string | null; transfer_safeguard: string | null;
  processors: string[]; security_controls: string | null; next_review_date: string | null;
}
export interface RopaRecord extends RopaInput { id: string; owner_name: string | null; updated_at: string }
export interface DataRequestInput {
  requester_name: string; requester_contact: string | null; request_type: string; channel: string; details: string | null;
  received_on: string; due_on?: string | null;
}
export interface DataRequest extends DataRequestInput {
  id: string; due_on: string; identity_verified: boolean; status: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "REJECTED";
  response_note: string | null; completed_on: string | null; days_left: number;
}
export interface IncidentInput {
  title: string; description: string | null; discovered_at: string; occurred_at: string | null; data_categories: string[];
  subjects_affected: number | null; severity: "LOW" | "MEDIUM" | "HIGH"; harm_likely: boolean;
}
export interface Incident extends IncidentInput {
  id: string; status: "OPEN" | "CONTAINED" | "REPORTED" | "CLOSED"; authority_notified_at: string | null;
  subjects_notified_at: string | null; root_cause: string | null; actions_taken: string | null; notify_deadline: string;
}
export interface PdplOverview {
  records: { n: number; no_owner: number; cross_border: number; sensitive: number; review_overdue: number };
  requests: { open: number; overdue: number };
  incidents: { open: number; notify_overdue: number };
  dpia?: { n: number; approved: number; open: number; high_residual: number };
  notify_hours: number; request_days: number;
}

// ---------- الاستشارات القانونية
export interface LegalRate { topic: string; title: string; description: string | null; tier: "GENERAL" | "SPECIALIZED"; hourly_rate_sar: number }
export interface LegalRatesInfo {
  rates: LegalRate[]; durations: number[]; vat_pct: number; urgent_pct: number; plan_tier: string | null; plan_discount_pct: number;
}
export interface LegalQuote {
  hourly_rate: number; minutes: number; base: number; urgent_pct: number; urgent_fee: number; discount_pct: number;
  discount: number; subtotal: number; vat_pct: number; vat: number; total: number;
}
export interface LegalBookInput {
  topic: string; duration_minutes: number; urgent: boolean; subject: string; details: string | null;
  mode: "VIDEO" | "PHONE" | "IN_PERSON"; preferred_at: string;
}
export interface Consultation {
  id: string; topic: string; topic_title: string; subject: string; details: string | null; duration_minutes: number;
  urgent: boolean; mode: string; preferred_at: string; price: LegalQuote; total_sar: number;
  status: "REQUESTED" | "CONFIRMED" | "COMPLETED" | "CANCELED"; scheduled_at: string | null; meeting_link: string | null;
  payment_status: "UNPAID" | "PAID" | "REFUNDED"; cancel_reason: string | null; lawyer_summary: string | null;
  created_at: string; lawyer_name: string | null; lawyer_license: string | null;
}
export interface AdminConsultation extends Consultation {
  lawyer_id: string | null; payment_reference: string | null; org_name: string; org_id: string; requested_by_name: string | null;
}
export interface Lawyer {
  id: string; full_name: string; license_number: string; specialties: string[]; bio: string | null;
  email: string | null; phone_number: string | null; is_active: boolean;
}

// ---------- تقييم الأثر (DPIA)
export type RiskLevel4 = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export interface DpiaQuestion { key: string; section: string; q: string; weight: number; trigger: boolean; mitigation: string }
export interface DpiaQuestionnaire { version: string; levels: Record<RiskLevel4, string>; questions: DpiaQuestion[] }
export interface DpiaMitigation { code: string; text: string; owner: string | null; due_on?: string | null; status: "PLANNED" | "IN_PROGRESS" | "DONE" }
export interface DpiaInput {
  project_name: string; description: string | null; related_record_id: string | null;
  answers: Record<string, boolean>; mitigations: DpiaMitigation[] | null; dpo_opinion: string | null;
}
export interface Dpia {
  id: string; project_name: string; description: string | null; related_record_id: string | null; related_activity: string | null;
  questionnaire_version: string; answers: Record<string, boolean>; risk_score: number; risk_level: RiskLevel4;
  residual_score: number; residual_level: RiskLevel4; mitigations: DpiaMitigation[]; dpo_opinion: string | null;
  status: "IN_PROGRESS" | "COMPLETED" | "APPROVED"; completed_at: string | null; approved_at: string | null;
  approved_by_name: string | null; created_by_name: string | null; created_at: string; updated_at: string;
  required: boolean; triggers: string[]; open_mitigations: number;
}

// ---------- المنشآت المتعددة
export interface GroupEntity {
  id: string; name: string; cr_number: string; entity_legal_type: string; entity_relation: "SUBSIDIARY" | "BRANCH" | "AFFILIATE" | null;
  commercial_size: string | null; haseef_score: number | null; score_computed_at: string | null; role: string; plan_tier: string | null;
  items: { expired: number; expiring: number; total: number }; policies_due: number;
  obligations: { pending: number; total: number }; open_incidents: number; structure_score: number | null;
}
export interface GroupOverview {
  available: boolean; root_id: string; entities: GroupEntity[]; can_manage: boolean; max_entities: number; hidden_entities?: number;
  totals?: { entities: number; avg_score: number | null; expired: number; expiring: number; policies_due: number; obligations_pending: number; open_incidents: number };
}
export interface GroupEntityInput {
  name: string; cr_number: string; entity_legal_type: string; entity_relation: "SUBSIDIARY" | "BRANCH" | "AFFILIATE";
  industry_type: string | null; commercial_size: "MICRO" | "SMALL" | "MEDIUM" | null;
}

// ---------- تقرير مجلس الإدارة
export interface BoardReport {
  year: number; generated_on: string;
  org: { name: string; cr_number: string; entity_legal_type: string; industry_type: string | null; commercial_size: string | null };
  plan: { tier: string | null; name: string | null };
  score: { value: number | null; pillars: Record<string, number | null>; reasons: { pillar: string; severity: string; text: string }[]; computed_at: string | null };
  structure: { name: string; body_type: string; meetings_per_year: number | null;
    members: { full_name: string; position: string; is_independent: boolean; is_executive: boolean; term_ends_on: string | null }[] }[];
  governance_check: { structure_score: number | null; passed: number; failed: number; run_at: string | null;
    failed_items: { code: string; title: string; message: string; severity: string; level: string }[] };
  resolutions: { total: number; by_type: Record<string, number>; list: { title: string; resolution_type: string; meeting_date: string; status: string }[] };
  meetings: { body: string; body_type: string; required: number; held: number | null }[];
  compliance: { active: number; expiring: number; expired: number; total: number; renewed_in_year: number;
    attention: { title: string; expiry_date: string; risk_level: string }[] };
  policies: { active: number; overdue: number; needs_review: number; drafts: number; approved_in_year: number };
  obligations: { counts: Record<string, number>; pending: { title: string; risk_level: string; authority: string | null }[] };
  pdpl: { records: number; requests: { total: number; on_time: number; open: number };
    incidents: { total: number; notified_in_time: number; harm_likely: number; open: number };
    dpia: { total: number; approved: number; high_residual: number } };
  legal: { completed: number; open: number };
  recommendations: { priority: string; area: string; text: string }[];
}
export interface BoardReportResponse {
  live: BoardReport; saved: { snapshot: BoardReport; notes: string | null; saved_at: string; saved_by_name: string | null } | null;
  saved_years: number[];
}

// ---------- التنبيهات
export type AlertTargetType = "COMPLIANCE_ITEM" | "POLICY" | "EMPLOYEE_DOC" | "LABOR_TASK" | "TAX_TASK";
export interface AlertRuleView { target_type: string; days_before: number[]; channels: string[]; is_enabled: boolean; is_default: boolean }
export interface AlertsOverview {
  plan: { tier: string | null; name: string | null; active: boolean };
  whatsapp: { provider: string; live: boolean; limit: number | null; used: number; remaining: number | null };
  send_hour: number;
  rules: Partial<Record<AlertTargetType, AlertRuleView>> & Record<"COMPLIANCE_ITEM" | "POLICY", AlertRuleView>; custom_rules: number;
  recipients: { membership_id: string; full_name: string; email: string | null; phone: string | null; role: string;
    receives_alerts: boolean; alert_channels: string[]; is_me: boolean }[];
  upcoming: { target_type: string; target_id: string; title: string; due_date: string; alert_on: string; threshold_days: number; channels: string[] }[];
  log: { id: string; target_type: string; title: string | null; due_date: string; threshold_days: number; channel: string; status: string;
    skip_reason: string | null; scheduled_for: string; sent_at: string | null; delivered_at: string | null; recipient_name: string | null }[];
  can_manage: boolean;
}

// ---------- طلبات التجربة
export interface TrialInput {
  full_name: string; company_name: string; email: string; phone_number: string | null; legal_type: string | null;
  employees_range: "1-9" | "10-49" | "50-249" | "250+" | null; plan_interest: "ESSENTIAL" | "PROFESSIONAL_GRC" | "ENTERPRISE" | "UNSURE";
  interests: string[]; message: string | null; source: string | null; consent: boolean; website?: string;
}
export interface TrialRequest extends Omit<TrialInput, "consent" | "website"> {
  id: string; status: "NEW" | "CONTACTED" | "CONVERTED" | "REJECTED"; notes: string | null; created_at: string; updated_at: string;
  handled_by_name: string | null;
}

// ---------- العمل والموظفين
export interface LaborProfile { salary_day: number; nitaqat_band: string | null; nitaqat_checked_on: string | null; gosi_employer_no: string | null }
export interface LaborTask {
  id: string; period: string; kind: LaborTaskKind; label: string; due_date: string; amount: number | null; done_at: string | null;
  reference: string | null; done_by_name: string | null; days_left: number; overdue: boolean; penalty_estimate?: number;
}
export interface LaborOverview {
  enabled: boolean; profile: LaborProfile | null; tasks: LaborTask[]; hr: boolean; can_manage: boolean; today: string;
  indicators?: ReturnType<typeof qiwaIndicators>;
  documents?: { employee_id: string; full_name: string; kind: string; label: string; due_date: string; days_left: number }[];
  gosi_month?: { period: string; employee_total: number; employer_total: number; total: number };
}
export interface EmployeeInput {
  full_name: string; nationality: Nationality; job_title: string | null; start_date: string; gosi_system: GosiSystem;
  basic_wage: number; housing_allowance: number; gosi_registered: boolean; qiwa_contract_documented: boolean;
  contract_end_date: string | null; probation_end_date: string | null; iqama_expiry: string | null; work_permit_expiry: string | null;
  mobile?: string | null;
}
export interface Employee extends Omit<EmployeeInput, "basic_wage" | "housing_allowance"> {
  id: string; basic_wage: number | null; housing_allowance: number | null; is_active: boolean; left_on: string | null;
}
export interface GosiCalcResult { base: number; employee: number; employer: number; total: number; employee_pct: number; employer_pct: number; on?: string }
export interface GosiMonth {
  period: string; employee_total: number; employer_total: number; total: number;
  lines: (GosiCalcResult & { employee_id: string; full_name: string; nationality: Nationality; gosi_system: GosiSystem; gosi_registered: boolean })[];
}

// ---------- التسعير والتسجيل والدفع
export interface PlanPrice { tier: string; name_ar: string; monthly_price_sar: number; yearly_price_sar: number; monthly_whatsapp_alerts: number | null }
export interface AddonPrice { code: string; name: string; monthly_price: number; included_tiers: string[];
  limits: { members?: number | null; questions?: number | null; included_unlimited?: boolean; extra_members_block?: number; extra_block_price?: number }; is_active: boolean }
export interface PublicPricing { plans: PlanPrice[]; addons: AddonPrice[] }
export interface SignupInput {
  company_name: string; cr_number: string; entity_legal_type: string; full_name: string; email: string; phone_number: string | null;
  password: string; plan_tier: string; consent: boolean; website?: string;
}
export interface OnboardingState {
  name: string; entity_legal_type: string; commercial_size: string | null; industry_type: string | null; onboarded_at: string | null;
  signup_source: string; email_verified: boolean; phone_number: string | null; plan_tier: string | null; billing_status: string | null;
  ends_at: string | null; needs_onboarding: boolean;
}
export interface OnboardingInput {
  commercial_size: "MICRO" | "SMALL" | "MEDIUM"; industry_type: string | null; employees_count: number; labor_enabled: boolean; salary_day: number;
  vat_registered: boolean; vat_frequency: "MONTHLY" | "QUARTERLY"; withholding_applies: boolean; fiscal_year_end_month: number; alert_phone: string | null;
}
export interface AddonAccess { code: string; name: string; price: number | null; via: "PLAN" | "ADDON" | null; paid_until: string | null;
  limits: { members?: number | null; questions?: number | null }; plan_tier: string | null }
export interface CheckoutOptions {
  plans: PlanPrice[]; addons: AddonPrice[]; vat_rate: number; provider: string; can_pay: boolean;
  subscription: { plan_tier: string; billing_cycle: string; billing_status: string; ends_at: string } | null;
  next_installment: { id: string; seq: number; due_date: string; amount_net: number; installments: number } | null;
  bot: AddonAccess;
  attendance?: AddonAccess;
}
export interface PaymentIntent { id: string; purpose: string; description: string; amount_net: number; vat_amount: number; total: number;
  status: "INITIATED" | "PAID" | "FAILED" | "EXPIRED"; created_at: string; paid_at: string | null; invoice_id: string | null; provider: string }

// ---------- الزكاة والضريبة
export interface TaxProfile { vat_registered: boolean; vat_frequency: "MONTHLY" | "QUARTERLY"; withholding_applies: boolean; zakat_applies: boolean; fiscal_year_end_month: number }
export interface TaxTask { id: string; kind: TaxKind; period_start: string; period_end: string; due_date: string; amount: number | null;
  done_at: string | null; reference: string | null; done_by_name: string | null; label: string; period_label: string; days_left: number; overdue: boolean }
export interface TaxOverview { enabled: boolean; profile: TaxProfile | null; tasks: TaxTask[]; can_manage: boolean; today: string }

// ---------- بوت الموظفين
export interface BotMember { id: string; full_name: string; phone: string; status: "INVITED" | "PENDING" | "ACTIVE"; joined_via: string;
  consent_at: string | null; created_at: string; employee_id: string | null; acks: number }
export interface BotOverview {
  access: AddonAccess; can_manage: boolean; live: boolean;
  settings?: { enabled: boolean; invite_code: string; welcome_text: string | null; hr_contact: string | null; require_approval: boolean };
  members?: BotMember[];
  policies?: { id: string; title: string; version: string; shared_with_employees: boolean; employee_summary: string | null; acks: number }[];
  faqs?: { id: string; question: string; answer: string; is_active: boolean }[];
  log?: { id: number; direction: "IN" | "OUT"; body: string; intent: string | null; simulated: boolean; created_at: string; full_name: string | null }[];
  unanswered?: { body: string; created_at: string; full_name: string | null }[];
  stats?: { members_active: number; members_total: number; questions_month: number; shared_policies: number };
  employees?: { id: string; full_name: string }[];
}

// ---------- الحضور
export interface AttendanceSettings { work_start: string; work_end: string; grace_minutes: number; work_days: number[]; require_device: boolean; retention_days: number }
export interface SiteInput { name: string; lat: number; lng: number; radius_m: number; max_accuracy_m: number; is_active: boolean }
export interface AttendanceRecord { id: number; kind: "IN" | "OUT"; at: string; status: "ACCEPTED" | "REJECTED"; reason: string | null; reason_label: string | null;
  distance_m: number | null; accuracy_m: number | null; late_minutes: number | null; flags: string[]; flag_labels: string[]; full_name: string; site_name: string | null }
export interface AttendanceOverview {
  access: AddonAccess; can_manage: boolean;
  settings?: AttendanceSettings; sites?: (SiteInput & { id: string })[];
  people?: { employee_id: string; full_name: string; job_title: string | null; has_link: boolean; device_since: string | null; device_label: string | null;
    last_used_at: string | null; in_at: string | null; out_at: string | null; late_minutes: number | null }[];
  recent?: AttendanceRecord[]; limit?: number | null; linked?: number;
}
export interface AttendanceReport { month: string; workdays: number; rows: { id: string; full_name: string; days_present: number; late_days: number;
  late_minutes: number; rejected: number; flagged: number; absent_days: number; leave_days?: number }[] }
export interface AttendPage { employee_name: string; org_name: string; has_device: boolean; require_device: boolean; sites: string[];
  today: { kind: "IN" | "OUT"; at: string; status: string; reason: string | null; reason_label: string | null; late_minutes: number | null }[];
  webauthn: { rp_id: string; rp_name: string; challenge: string; purpose: "ENROLL" | "CHECK"; user_id: string; credential_id: string | null } }
export interface AttendCheckInput { kind: "IN" | "OUT"; lat: number; lng: number; accuracy: number; challenge?: string | null; credential_id?: string | null;
  client_data_json?: string | null; authenticator_data?: string | null; signature?: string | null }
export interface AttendCheckResult { status: "ACCEPTED" | "REJECTED"; reason: string | null; reason_label: string | null; distance_m: number | null;
  site_name: string | null; late_minutes: number | null; at: string; kind: "IN" | "OUT" }

// ---------- الموارد البشرية
export interface HrSettings { count_workdays_only: boolean; objection_days: number; notify_employees: boolean }
export interface LeaveBalance { year: number; entitlement: number; adjustments: number; used: number; balance: number }
export interface LeaveRow { id: string; employee_id: string; full_name: string; leave_type: LeaveType; label: string; start_date: string; end_date: string; days: number;
  reason: string | null; medical_ref: string | null; status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"; source: "LINK" | "BOT" | "HR";
  decision_note: string | null; decided_at: string | null; return_date: string | null; return_submitted_at: string | null; return_confirmed_at: string | null;
  created_at: string; on_leave_now: boolean; awaiting_return: boolean; late_return_days: number; pay_note?: string }
export interface HrOverview {
  access: AddonAccess; can_manage: boolean; settings: HrSettings;
  policies: (LeavePolicy & { leave_type: LeaveType; label: string; is_active: boolean })[];
  people: ({ id: string; full_name: string; job_title: string | null; mobile: string | null } & LeaveBalance)[];
  leaves: LeaveRow[]; stats: { pending: number; on_leave: number; awaiting_return: number };
}
export interface NoticeRow { id: string; employee_id: string; full_name: string; kind: DeductionKind; kind_label: string; incident_date: string; description: string;
  amount: number; payroll_month: string; status: "ISSUED" | "OBJECTED" | "CONFIRMED" | "CANCELLED"; seen_at: string | null; objection_text: string | null;
  objected_at: string | null; decision_note: string | null; decided_at: string | null; created_at: string; leave_request_id: string | null }
export interface DeductionSuggestion { employee_id: string; full_name: string; kind: DeductionKind; kind_label: string; incident_date: string; amount: number;
  description: string; leave_request_id?: string | null }
export interface HrDeductions { month: string; notices: NoticeRow[]; suggestions: DeductionSuggestion[]; objection_days: number;
  summary: { employee_id: string; full_name: string; fines: number; total: number; confirmed: number; fine_cap: number; half_wage: number }[] }
export interface PersonHr {
  balance: LeaveBalance; objection_days: number; count_workdays_only: boolean;
  policies: (LeavePolicy & { leave_type: LeaveType; label: string; used: number })[];
  leaves: Omit<LeaveRow, "employee_id" | "full_name" | "on_leave_now" | "awaiting_return" | "late_return_days" | "decided_at">[];
  notices: Omit<NoticeRow, "employee_id" | "full_name" | "kind_label" | "seen_at" | "decided_at" | "leave_request_id">[];
}
export interface AnnualEventInput { code: string; name: string; event_date: string; kind: "NATIONAL" | "RELIGIOUS" | "OCCASION"; is_holiday: boolean; holiday_days: number;
  greeting: string; notify_subscribers: boolean; is_active: boolean }
export interface AnnualEvent extends AnnualEventInput { id: string; sent_subscribers?: number; sent_employees?: number }
export interface EventsView { events: AnnualEvent[]; can_manage: boolean; settings: { enabled: boolean; signature: string | null; excluded_codes: string[] };
  org_name: string; reachable_employees: number; sent_total: number }
