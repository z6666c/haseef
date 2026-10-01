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
export function createApi(baseUrl: string, getSession: () => Session | null, onUnauthorized?: () => void) {
  async function req<T>(path: string, init: RequestInit & { org?: boolean } = {}): Promise<T> {
    const s = getSession();
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    if (s?.token) headers.set("Authorization", `Bearer ${s.token}`);
    if (init.org !== false && s?.orgId) headers.set("X-Org-Id", s.orgId);

    const res = await fetch(`${baseUrl}/v1${path}`, { ...init, headers });
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

  return {
    login: (email: string, password: string) =>
      req<{ access_token: string }>("/auth/login", { method: "POST", org: false, body: JSON.stringify({ email, password }) }),
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
    },
  };
}

export type Api = ReturnType<typeof createApi>;

export interface AdminOverview {
  kpis: { active_orgs: number; trials: number; mrr_sar: number; avg_score: number | null };
  by_plan: { plan_tier: string; n: number }[];
  by_industry: { industry: string; n: number }[];
}
export interface AdminOrg {
  id: string; name: string; cr_number: string; industry_type: string | null; haseef_score: number | null;
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
