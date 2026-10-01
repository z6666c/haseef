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
  fetchImpl: typeof fetch = (...a) => fetch(...a),
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

  return {
    login: (email: string, password: string) =>
      req<{ access_token: string; must_change_password: boolean }>("/auth/login", { method: "POST", org: false, body: JSON.stringify({ email, password }) }),
    changePassword: (current_password: string, new_password: string) =>
      req<void>("/auth/change-password", { method: "POST", org: false, body: JSON.stringify({ current_password, new_password }) }),
    me: () => req<Me>("/auth/me", { org: false }),

    dashboard: () => req<Dashboard>("/dashboard"),
    listItems: () => req<ComplianceItem[]>("/compliance-items"),
    createItem: (body: ComplianceItemInput) =>
      req<ComplianceItem>("/compliance-items", { method: "POST", body: JSON.stringify(body) }),
    renewItem: (id: string, new_expiry_date: string) =>
      req<ComplianceItem>(`/compliance-items/${id}/renew`, { method: "POST", body: JSON.stringify({ new_expiry_date }) }),
    archiveItem: (id: string) => req<void>(`/compliance-items/${id}`, { method: "DELETE" }),
    remindNow: (id: string) =>
      req<{ queued: number; message: string }>(`/compliance-items/${id}/remind`, { method: "POST" }),

    admin: {
      overview: () => req<AdminOverview>("/admin/overview", { org: false }),
      organizations: () => req<AdminOrg[]>("/admin/organizations", { org: false }),
      dispatches: (status?: string) =>
        req<AdminDispatches>(`/admin/dispatches${status ? `?status=${encodeURIComponent(status)}` : ""}`, { org: false }),
      aiUsage: () => req<AdminUsage[]>("/admin/ai-usage", { org: false }),

      me: () => req<{ user_id: string; role: PlatformRole }>("/admin/me", { org: false }),
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
      teamAdd: (b: { email: string; full_name: string; role: PlatformRole }) => post<{ temporary_password: string | null }>("/admin/team", b),
      teamRole: (uid: string, role: PlatformRole | null) =>
        req<{ role: PlatformRole | null }>(`/admin/team/${uid}`, { method: "PATCH", org: false, body: JSON.stringify({ role }) }),
      audit: (orgId?: string) => req<AuditEntry[]>(`/admin/audit${orgId ? `?org_id=${orgId}` : ""}`, { org: false }),
    },
  };
}

export type Api = ReturnType<typeof createApi>;

export interface AdminOverview {
  kpis: { active_orgs: number; trials: number; mrr_sar: number; avg_score: number | null };
  by_plan: { plan_tier: string; n: number }[];
  by_industry: { industry: string; n: number }[];
}
export type PlatformRole = "SUPER_ADMIN" | "SUPPORT" | "BILLING";

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
  audits_this_month: number; tokens: number; cost_sar: number;
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
  counts: { items: number; expired: number; policies: number };
}
export interface CreateOrgInput {
  name: string; cr_number: string; entity_legal_type: string; industry_type?: string; commercial_size?: string;
  plan_tier: string; trial_days: number; admin_email: string; admin_full_name: string; admin_phone?: string;
}
export interface CreateOrgResult { id: string; temporary_password: string | null; admin_existing_user: boolean }
export interface TeamMember {
  id: string; full_name: string; email: string; platform_role: PlatformRole; is_active: boolean;
  last_login_at: string | null; must_change_password: boolean;
}
export interface AuditEntry {
  id: number; created_at: string; action: string; entity_type: string; entity_id: string | null;
  changes: Record<string, unknown> | null; ip: string | null; actor: string | null; actor_role: string | null;
  org_name: string | null; org_id: string | null;
}
