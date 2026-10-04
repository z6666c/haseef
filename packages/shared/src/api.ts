import type { ComplianceItem, ComplianceItemInput, Dashboard, Me } from "./types.ts";

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
    setAlertRule: (b: { target_type: "COMPLIANCE_ITEM" | "POLICY"; target_id: null; days_before: number[]; channels: string[]; is_enabled: boolean }) =>
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
      invoices: (period?: string, q?: string) => {
        const p = new URLSearchParams(); if (period) p.set("period", period); if (q) p.set("q", q);
        const qs = p.toString();
        return req<InvoiceRow[]>(`/admin/finance/invoices${qs ? `?${qs}` : ""}`, { org: false });
      },
      invoice: (id: string) => req<Invoice>(`/admin/finance/invoices/${id}`, { org: false }),
      voidInvoice: (id: string, reason: string) => post<{ credit_note: { id: string; number: string } }>(`/admin/finance/invoices/${id}/void`, { reason }),
      expenses: (period?: string) => req<Expense[]>(`/admin/finance/expenses${period ? `?period=${encodeURIComponent(period)}` : ""}`, { org: false }),
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
  status: "ISSUED" | "VOID"; payment_reference: string | null; related_number: string | null;
}
export interface Invoice extends InvoiceRow {
  buyer_cr: string | null; buyer_vat: string | null; seller: HaseefProfile; lines: InvoiceLineRow[]; vat_rate: number;
  note: string | null; qr: string | null; void_reason: string | null; credit_note_number: string | null; credit_note_id: string | null;
}
export interface ExpenseInput {
  spent_on: string; category: string; vendor: string; description: string | null; net_amount: number; vat_amount: number;
  reference: string | null; recurring: boolean;
}
export interface Expense extends ExpenseInput { id: string; total: number; created_at: string; created_by_name: string | null }
export interface FinanceSummary {
  period: string; from: string; to: string;
  revenue: { total: number; by_source: { source: string; net: number; vat: number; invoices: number; credit_notes: number }[] };
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
export interface AlertRuleView { target_type: string; days_before: number[]; channels: string[]; is_enabled: boolean; is_default: boolean }
export interface AlertsOverview {
  plan: { tier: string | null; name: string | null; active: boolean };
  whatsapp: { provider: string; live: boolean; limit: number | null; used: number; remaining: number | null };
  send_hour: number;
  rules: Record<"COMPLIANCE_ITEM" | "POLICY", AlertRuleView>; custom_rules: number;
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
