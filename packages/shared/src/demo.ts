// نسخة العرض: خادم وهمي داخل المتصفح ببيانات تجريبية، تُستخدم في رابط GitHub Pages فقط.
// يُفعّلها التطبيق بتمرير demoFetch إلى createApi عند NEXT_PUBLIC_DEMO=1 وقت البناء. لا شيء هنا يصل لقاعدة بيانات؛ التغييرات تبقى في الصفحة
// وتختفي بإعادة التحميل.

import type { ComplianceItem, Dashboard, Me, ScoreReason } from "./types.ts";
import CONTENT from "./demo-content.json" with { type: "json" };
import { runCheck, type CkStandard } from "./governanceCheck.ts";
import { dpiaAssess, dpiaSuggest } from "./dpia.ts";
import type { DpiaMitigation, DpiaQuestion } from "./api.ts";


/** بيانات الدخول لنسخة العرض فقط. ليست حسابات حقيقية ولا تفتح أي نظام فعلي. */
const DEMO_USERS: Record<string, { password: string; token: string }> = {
  "demo@haseef.sa": { password: "Haseef@2026", token: "demo-client" },
  "admin@haseef.sa": { password: "admin@haseef.sa@", token: "demo-admin" },
  "support@haseef.sa": { password: "support@haseef.sa@", token: "demo-support" },
  "billing@haseef.sa": { password: "billing@haseef.sa@", token: "demo-billing" },
};

const ORG_A = "0a1f5c1e-0000-4000-8000-000000000001";
const ORG_B = "0a1f5c1e-0000-4000-8000-000000000002";
const ORG_C = "0a1f5c1e-0000-4000-8000-000000000003";
export const DEMO_ORG_IDS = [ORG_A, ORG_B, ORG_C];

// ---------- أدوات التاريخ (توقيت الرياض) ----------
const DAY = 86_400_000;
function riyadhToday(): Date {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  return new Date(`${s}T00:00:00Z`);
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const inDays = (n: number) => iso(new Date(riyadhToday().getTime() + n * DAY));
const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();
const daysLeft = (date: string) => Math.round((new Date(`${date}T00:00:00Z`).getTime() - riyadhToday().getTime()) / DAY);
let seq = 100;
const uid = () => `0a1f5c1e-0000-4000-9000-${String(++seq).padStart(12, "0")}`;

// ---------- بيانات المنشأة (واجهة العميل) ----------
type StoredItem = Omit<ComplianceItem, "status" | "days_remaining" | "action_required">;
const items: StoredItem[] = [
  { id: uid(), category: "BALADY", title: "رخصة بلدي — الفرع الرئيسي", reference_number: "BL-4471", issue_date: null, expiry_date: inDays(0), risk_level: "CRITICAL", renewal_url: "https://balady.gov.sa" },
  { id: uid(), category: "CHI_INSURANCE", title: "التأمين الطبي للموظفين", reference_number: null, issue_date: null, expiry_date: inDays(5), risk_level: "HIGH", renewal_url: null },
  { id: uid(), category: "CIVIL_DEFENSE", title: "شهادة الدفاع المدني", reference_number: null, issue_date: null, expiry_date: inDays(34), risk_level: "HIGH", renewal_url: "https://salamah.998.gov.sa" },
  { id: uid(), category: "QIWA_NITAQAT", title: "شهادة السعودة", reference_number: null, issue_date: null, expiry_date: inDays(75), risk_level: "HIGH", renewal_url: "https://qiwa.sa" },
  { id: uid(), category: "COMMERCIAL_REG", title: "السجل التجاري", reference_number: "1010123456", issue_date: null, expiry_date: inDays(140), risk_level: "CRITICAL", renewal_url: "https://mc.gov.sa" },
  { id: uid(), category: "ZATCA", title: "شهادة الزكاة", reference_number: null, issue_date: null, expiry_date: inDays(210), risk_level: "HIGH", renewal_url: "https://zatca.gov.sa" },
];

function view(i: StoredItem): ComplianceItem {
  const d = daysLeft(i.expiry_date);
  const status = d < 0 ? "EXPIRED" : d <= 30 ? "EXPIRING_SOON" : "ACTIVE";
  return { ...i, days_remaining: d, status, action_required: d <= 15 };
}
const itemViews = () => items.map(view).sort((a, b) => a.days_remaining - b.days_remaining);

function dashboard(): Dashboard {
  const all = itemViews();
  const reasons: ScoreReason[] = [];
  // ركن الحوكمة من نتيجة فحص الهيكل الفعلية، ويُخصم للسياسات التي فات موعد مراجعتها
  const chk = gov.latest_check as { structure_score: number | null } | null;
  let governance = Math.round(chk?.structure_score ?? 50);
  for (const x of policies.map(policyView).filter((x) => x.effective_status === "OVERDUE_REVIEW")) {
    governance -= 25;
    reasons.push({ pillar: "GOVERNANCE_PDPL", severity: "medium", text: `فات موعد مراجعة ${x.title}`, points: 25, points_label: "25 نقطة" });
  }
  if (!ropa.length) {
    governance -= 10;
    reasons.push({ pillar: "GOVERNANCE_PDPL", severity: "high", text: "سجل أنشطة معالجة البيانات الشخصية فارغ", points: 10, points_label: "10 نقاط" });
  }
  governance = Math.max(0, governance);
  let operational = 100;
  for (const i of all) {
    if (i.status === "EXPIRED") {
      const p = i.risk_level === "CRITICAL" ? 20 : 12;
      operational -= p;
      reasons.push({ pillar: "OPERATIONAL", severity: "critical", text: `انتهت صلاحية ${i.title}`, points: p, points_label: `${p} نقطة` });
    } else if (i.status === "EXPIRING_SOON") {
      const p = i.days_remaining <= 7 ? 5 : 2;
      operational -= p;
      const when = i.days_remaining === 0 ? "اليوم" : `خلال ${i.days_remaining} أيام`;
      reasons.push({ pillar: "OPERATIONAL", severity: "medium", text: `تنتهي صلاحية ${i.title} ${when}`, points: p, points_label: p <= 10 && p >= 3 ? `${p} نقاط` : `${p} نقطة` });
    }
  }
  operational = Math.max(0, operational);
  const score = Math.round((operational + governance) / 2);
  return {
    org_name: "مؤسسة النخبة للمقاولات", cr_number: "1010123456", greeting_name: "أحمد العتيبي",
    plan_tier: "PROFESSIONAL_GRC", automation_active: true,
    score: {
      score, pillars: { OPERATIONAL: operational, GOVERNANCE_PDPL: governance, CONTRACTS: null },
      weights_used: { OPERATIONAL: 50, GOVERNANCE_PDPL: 50 }, capped_by_critical_expiry: false,
      reasons: reasons.sort((a, b) => b.points - a.points), computed_at: ago(5),
    },
    action_required: all.filter((i) => i.action_required),
    counts: {
      active: all.filter((i) => i.status === "ACTIVE").length,
      expiring_soon: all.filter((i) => i.status === "EXPIRING_SOON").length,
      expired: all.filter((i) => i.status === "EXPIRED").length,
      policies_due: policies.map(policyView).filter((x) => x.effective_status === "NEEDS_REVIEW" || x.effective_status === "OVERDUE_REVIEW").length,
    },
    governance: { available: true, last_meeting_title: null, last_meeting_date: null, last_meeting_status: null, doa_rules: 0, doa_last_updated: null },
    pdpl: { available: true, records: ropa.length, complete_records: ropa.filter((r) => r.purpose && r.owner_membership_id).length,
            completeness_pct: ropa.length ? Math.round(100 * ropa.filter((r) => r.purpose && r.owner_membership_id).length / ropa.length) : null,
            cross_border: ropa.filter((r) => r.cross_border_transfer).length },
  };
}

const CLIENT_ME: Me = {
  id: "0a1f5c1e-0000-4000-8000-0000000000a1", email: "demo@haseef.sa", full_name: "أحمد العتيبي", is_platform_admin: false,
  memberships: [{ org_id: ORG_A, org_name: "مؤسسة النخبة للمقاولات", cr_number: "1010123456", role: "ORG_ADMIN" }],
};
const ADMIN_ME: Me = { id: "0a1f5c1e-0000-4000-8000-0000000000b1", email: "admin@haseef.sa", full_name: "فريق عمليات حصيف", is_platform_admin: true, memberships: [] };

// ---------- بيانات لوحة التحكم ----------
const PRICES: Record<string, [number, number]> = { ESSENTIAL: [199, 1990], PROFESSIONAL_GRC: [499, 4990], ENTERPRISE: [1299, 12990] };
type Org = {
  id: string; name: string; cr: string; legal: string; industry: string; size: string; score: number | null;
  suspended_at: string | null; reason: string | null; created_at: string;
  sub: { id: string; plan_tier: string; billing_cycle: string; billing_status: string; starts_at: string; ends_at: string } | null;
  members: { membership_id: string; role: string; user_id: string; full_name: string; email: string; phone: string | null; active: boolean; last: string | null }[];
  billing: { event_type: string; plan_tier: string | null; amount_sar: number | null; period_months: number | null; reference: string | null; note: string | null; created_at: string; actor: string | null }[];
  counts: { items: number; expired: number; policies: number };
};
const ts = (n: number) => new Date(riyadhToday().getTime() + n * DAY).toISOString();
const orgs: Org[] = [
  {
    id: ORG_A, name: "مؤسسة النخبة للمقاولات", cr: "1010123456", legal: "SOLE_PROPRIETORSHIP", industry: "المقاولات", size: "SMALL",
    score: 66, suspended_at: null, reason: null, created_at: ts(-40),
    sub: { id: uid(), plan_tier: "PROFESSIONAL_GRC", billing_cycle: "MONTHLY", billing_status: "ACTIVE", starts_at: ts(-10), ends_at: ts(20) },
    members: [
      { membership_id: uid(), role: "ORG_ADMIN", user_id: CLIENT_ME.id, full_name: "أحمد العتيبي", email: "demo@haseef.sa", phone: "+966500000001", active: true, last: ago(30) },
      { membership_id: uid(), role: "EXTERNAL_ADVISOR", user_id: uid(), full_name: "مكتب المستشار القانوني", email: "advisor@example.sa", phone: null, active: true, last: ago(60 * 26) },
    ],
    billing: [
      { event_type: "PAYMENT", plan_tier: "PROFESSIONAL_GRC", amount_sar: 499, period_months: 1, reference: "INV-2026-0007", note: null, created_at: ts(-10), actor: "فريق عمليات حصيف" },
      { event_type: "TRIAL_STARTED", plan_tier: "PROFESSIONAL_GRC", amount_sar: null, period_months: null, reference: null, note: "14 يوماً", created_at: ts(-40), actor: "فريق عمليات حصيف" },
    ],
    counts: { items: 6, expired: 0, policies: 3 },
  },
  {
    id: ORG_B, name: "شركة واحة التقنية", cr: "2050654321", legal: "LLC", industry: "تقنية المعلومات", size: "MEDIUM",
    score: 85, suspended_at: null, reason: null, created_at: ts(-75),
    sub: { id: uid(), plan_tier: "ESSENTIAL", billing_cycle: "YEARLY", billing_status: "ACTIVE", starts_at: ts(-60), ends_at: ts(305) },
    members: [
      { membership_id: uid(), role: "ORG_ADMIN", user_id: uid(), full_name: "سارة القحطاني", email: "sara@waha.example", phone: "+966500000002", active: true, last: ago(60 * 5) },
      { membership_id: uid(), role: "DPO", user_id: uid(), full_name: "فهد الشمري", email: "fahad@waha.example", phone: null, active: true, last: null },
    ],
    billing: [{ event_type: "PAYMENT", plan_tier: "ESSENTIAL", amount_sar: 1990, period_months: 12, reference: "INV-2026-0003", note: null, created_at: ts(-60), actor: "المحاسبة" }],
    counts: { items: 5, expired: 0, policies: 4 },
  },
  {
    id: ORG_C, name: "شركة الأفق للتجارة", cr: "4030111222", legal: "LLC", industry: "التجارة", size: "SMALL",
    score: null, suspended_at: null, reason: null, created_at: ts(-3),
    sub: { id: uid(), plan_tier: "PROFESSIONAL_GRC", billing_cycle: "MONTHLY", billing_status: "TRIAL", starts_at: ts(-3), ends_at: ts(11) },
    members: [{ membership_id: uid(), role: "ORG_ADMIN", user_id: uid(), full_name: "خالد الزهراني", email: "khalid@ofoq.example", phone: null, active: true, last: null }],
    billing: [{ event_type: "TRIAL_STARTED", plan_tier: "PROFESSIONAL_GRC", amount_sar: null, period_months: null, reference: null, note: "14 يوماً", created_at: ts(-3), actor: "الدعم الفني" }],
    counts: { items: 0, expired: 0, policies: 0 },
  },
];
const team: { id: string; full_name: string; email: string; platform_role: string; is_active: boolean; last_login_at: string | null; must_change_password: boolean }[] = [
  { id: ADMIN_ME.id, full_name: "فريق عمليات حصيف", email: "admin@haseef.sa", platform_role: "SUPER_ADMIN", is_active: true, last_login_at: ago(1), must_change_password: false },
  { id: "0a1f5c1e-0000-4000-8000-0000000000b2", full_name: "الدعم الفني", email: "support@haseef.sa", platform_role: "SUPPORT", is_active: true, last_login_at: ago(60 * 3), must_change_password: false },
  { id: "0a1f5c1e-0000-4000-8000-0000000000b3", full_name: "المحاسبة", email: "billing@haseef.sa", platform_role: "BILLING", is_active: true, last_login_at: ago(60 * 30), must_change_password: false },
];
let auditSeq = 50;
const audit: { id: number; created_at: string; action: string; entity_type: string; entity_id: string | null; changes: Record<string, unknown> | null; ip: string | null; actor: string | null; actor_role: string | null; org_name: string | null; org_id: string | null }[] = [
  { id: 3, created_at: ts(-3), action: "ADMIN_CREATE_ORG", entity_type: "organization", entity_id: ORG_C, changes: { name: "شركة الأفق للتجارة", cr_number: "4030111222", plan: "PROFESSIONAL_GRC" }, ip: "10.0.0.4", actor: "الدعم الفني", actor_role: "SUPPORT", org_name: "شركة الأفق للتجارة", org_id: ORG_C },
  { id: 2, created_at: ts(-10), action: "ADMIN_RECORD_PAYMENT", entity_type: "subscription", entity_id: null, changes: { amount_sar: 499, cycle: "MONTHLY", reference: "INV-2026-0007" }, ip: "10.0.0.4", actor: "فريق عمليات حصيف", actor_role: "SUPER_ADMIN", org_name: "مؤسسة النخبة للمقاولات", org_id: ORG_A },
  { id: 1, created_at: ts(-60), action: "ADMIN_RECORD_PAYMENT", entity_type: "subscription", entity_id: null, changes: { amount_sar: 1990, cycle: "YEARLY", reference: "INV-2026-0003" }, ip: "10.0.0.7", actor: "المحاسبة", actor_role: "BILLING", org_name: "شركة واحة التقنية", org_id: ORG_B },
];
function log(action: string, org: Org | null, changes: Record<string, unknown> | null) {
  audit.unshift({ id: ++auditSeq, created_at: new Date().toISOString(), action, entity_type: org ? "organization" : "user", entity_id: org?.id ?? null,
    changes, ip: "—", actor: "فريق عمليات حصيف", actor_role: "SUPER_ADMIN", org_name: org?.name ?? null, org_id: org?.id ?? null });
}

const orgRow = (o: Org) => ({
  id: o.id, name: o.name, cr_number: o.cr, industry_type: o.industry, haseef_score: o.score, created_at: o.created_at,
  suspended_at: o.suspended_at, plan_tier: o.sub?.plan_tier ?? null, billing_status: o.sub?.billing_status ?? null,
  ends_at: o.sub?.ends_at ?? null, members: o.members.length,
});
const orgDetail = (o: Org) => ({
  organization: { id: o.id, name: o.name, cr_number: o.cr, entity_legal_type: o.legal, industry_type: o.industry, commercial_size: o.size,
    haseef_score: o.score, is_active: true, suspended_at: o.suspended_at, suspension_reason: o.reason, created_at: o.created_at },
  subscription: o.sub && { ...o.sub, monthly_price_sar: PRICES[o.sub.plan_tier][0], yearly_price_sar: PRICES[o.sub.plan_tier][1] },
  members: o.members.map((m) => ({ membership_id: m.membership_id, role: m.role, membership_active: m.active, receives_alerts: true,
    user_id: m.user_id, full_name: m.full_name, email: m.email, phone_number: m.phone, user_active: m.active,
    last_login_at: m.last, must_change_password: false, is_team_member: false })),
  billing: o.billing, counts: o.counts,
});
function overview() {
  const live = orgs.filter((o) => o.sub && !o.suspended_at && o.sub.billing_status !== "CANCELED");
  const mrr = live.filter((o) => o.sub!.billing_status === "ACTIVE")
    .reduce((s, o) => s + (o.sub!.billing_cycle === "YEARLY" ? PRICES[o.sub!.plan_tier][1] / 12 : PRICES[o.sub!.plan_tier][0]), 0);
  const scored = orgs.filter((o) => o.score !== null);
  const count = (f: (o: Org) => string) => Object.entries(live.reduce<Record<string, number>>((a, o) => ({ ...a, [f(o)]: (a[f(o)] ?? 0) + 1 }), {}));
  return {
    kpis: { active_orgs: live.length, trials: live.filter((o) => o.sub!.billing_status === "TRIAL").length, mrr_sar: mrr,
      avg_score: scored.length ? Math.round(scored.reduce((s, o) => s + o.score!, 0) / scored.length) : null },
    by_plan: count((o) => o.sub!.plan_tier).map(([plan_tier, n]) => ({ plan_tier, n })),
    by_industry: count((o) => o.industry).map(([industry, n]) => ({ industry, n })),
  };
}
function dispatches() {
  const mk = (org: string, target: string, ch: "WHATSAPP" | "EMAIL", to: string, status: string, th: number, due: number, kind: "AUTO" | "MANUAL" = "AUTO") => ({
    id: uid(), org_name: org, target_type: target, channel: ch, recipient_address: to, status, threshold_days: th, due_date: inDays(due),
    scheduled_for: ts(status === "QUEUED" ? 0.375 : -1), sent_at: status === "QUEUED" ? null : ago(60 * 20),
    delivered_at: status === "DELIVERED" ? ago(60 * 19) : null, provider: status === "QUEUED" ? null : "WHATSAPP", attempts: status === "QUEUED" ? 0 : 1,
    last_error: null, skip_reason: null, kind,
  });
  const items = [
    mk("مؤسسة النخبة للمقاولات", "COMPLIANCE_ITEM", "WHATSAPP", "+966500000001", "QUEUED", 0, 0),
    mk("مؤسسة النخبة للمقاولات", "COMPLIANCE_ITEM", "EMAIL", "demo@haseef.sa", "QUEUED", 0, 0),
    mk("مؤسسة النخبة للمقاولات", "COMPLIANCE_ITEM", "WHATSAPP", "+966500000001", "QUEUED", 7, 5),
    mk("مؤسسة النخبة للمقاولات", "POLICY", "EMAIL", "advisor@example.sa", "QUEUED", 0, -10),
    mk("شركة واحة التقنية", "COMPLIANCE_ITEM", "WHATSAPP", "+966500000002", "DELIVERED", 30, 25),
    mk("شركة واحة التقنية", "COMPLIANCE_ITEM", "EMAIL", "sara@waha.example", "SENT", 30, 25),
    mk("مؤسسة النخبة للمقاولات", "COMPLIANCE_ITEM", "WHATSAPP", "+966500000001", "DELIVERED", -2, -2, "MANUAL"),
  ];
  return {
    last_7_days: [
      { status: "QUEUED", channel: "WHATSAPP", n: 2 }, { status: "QUEUED", channel: "EMAIL", n: 2 },
      { status: "DELIVERED", channel: "WHATSAPP", n: 2 }, { status: "SENT", channel: "EMAIL", n: 1 },
    ],
    items,
  };
}

// ---------- السياسات (نسخة العرض) ----------
type DemoPolicy = { id: string; source: string | null; policy_type: string; title: string; version: string;
  approval_date: string | null; review_due_date: string; status: string; body_md: string | null };
const policies: DemoPolicy[] = [
  { id: uid(), source: null, policy_type: "CONFLICT_OF_INTEREST", title: "سياسة تعارض المصالح", version: "1.0",
    approval_date: inDays(-200), review_due_date: inDays(165), status: "ACTIVE", body_md: null },
  { id: uid(), source: null, policy_type: "PRIVACY_POLICY", title: "سياسة الخصوصية", version: "1.1",
    approval_date: inDays(-120), review_due_date: inDays(245), status: "ACTIVE", body_md: null },
];
function policyView(x: DemoPolicy) {
  const d = daysLeft(x.review_due_date);
  const eff = x.status !== "ACTIVE" ? x.status : d < 0 ? "OVERDUE_REVIEW" : d <= 30 ? "NEEDS_REVIEW" : "ACTIVE";
  return { id: x.id, policy_type: x.policy_type, title: x.title, version: x.version, approval_date: x.approval_date,
           review_due_date: x.review_due_date, status: x.status, effective_status: eff, days_remaining: d };
}

// ---------- الحوكمة والمحتوى المرجعي (حالة قابلة للتعديل داخل الصفحة) ----------
type DemoMember = { id: string; full_name: string; position: string; is_independent: boolean; is_executive: boolean;
  appointed_on: string | null; term_ends_on: string | null };
type DemoBody = { id: string; body_type: string; name: string; mandate: string | null; meetings_per_year: number | null;
  sort: number; from_template: boolean; members: DemoMember[] };
type LibDoc = { id: string; slug: string | null; kind: "TEMPLATE" | "LAW" | "GUIDE" | "FILE"; category: string; title: string;
  summary: string | null; url: string | null; body_md: string | null; policy_type: string | null; file_name: string | null;
  file_mime: string | null; file_size: number | null; file_b64?: string | null; applies_legal_types: string[]; related_codes: string[];
  review_status: string; version: string; is_visible: boolean; min_plan: string | null; created_at: string; updated_at: string;
  created_by_name?: string | null };
const MEMBER_KEYS = ["full_name", "position", "is_independent", "is_executive", "appointed_on", "term_ends_on"];
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

const standards = clone(CONTENT.admin_standards) as (CkStandard & { is_visible: boolean; review_status: string; description: string;
  legal_reference: string | null; source_url: string | null; updated_at: string })[];
const obligationCatalog = clone(CONTENT.admin_obligations) as { code: string; is_visible: boolean; review_status: string; [k: string]: unknown }[];
const library: LibDoc[] = (clone(CONTENT.library) as Omit<LibDoc, "slug" | "is_visible" | "min_plan" | "created_at">[]).map((d) => ({
  ...d, slug: d.id, is_visible: true, min_plan: null, created_at: d.updated_at,
}));
library.push({ id: "file-sample", slug: null, kind: "FILE", category: "GOVERNANCE", title: "قائمة تحقق: الاستعداد للجمعية العامة السنوية",
  summary: "ملف مرفوع من فريق حصيف (مثال على رفع الملفات): 15 بنداً قبل الجمعية وبعدها.", url: null, body_md: null, policy_type: null,
  file_name: "قائمة-الاستعداد-للجمعية.txt", file_mime: "text/plain", file_size: 0, applies_legal_types: [], related_codes: [],
  review_status: "APPROVED", version: "1.0", is_visible: true, min_plan: null, created_at: ts(-5), updated_at: ts(-5), created_by_name: "الدعم الفني",
  file_b64: null });
const SAMPLE_FILE = `قائمة الاستعداد للجمعية العامة السنوية — حصيف

قبل 30 يوماً
[ ] اعتماد المجلس للقوائم المالية المراجعة
[ ] تحديد جدول الأعمال واعتماده من المجلس
[ ] تجهيز تقرير المجلس السنوي وتقرير لجنة المراجعة
[ ] ترشيح مراجع الحسابات وأتعابه (توصية لجنة المراجعة)

قبل 21 يوماً
[ ] نشر الدعوة وفق النظام الأساس ووسائل الإعلان المعتمدة
[ ] إتاحة المستندات للمساهمين / الشركاء
[ ] تجهيز التصويت الإلكتروني إن وُجد

يوم الجمعية
[ ] التحقق من النصاب وتسجيله
[ ] الإفصاح عن تعاملات الأطراف ذات العلاقة
[ ] التصويت على كل بند منفصلاً وتسجيل النتائج

خلال 15 يوماً بعدها
[ ] توقيع المحضر من الرئيس وأمين السر وجامع الأصوات
[ ] إيداع القوائم المالية والمحضر لدى الجهات المختصة
[ ] تحديث بيانات المراجع والمجلس في السجلات الرسمية
[ ] صرف الأرباح المعتمدة في موعدها
[ ] أرشفة المستندات في حصيف
`;
const sampleB64 = typeof btoa === "function" ? btoa(unescape(encodeURIComponent(SAMPLE_FILE))) : "";
library[library.length - 1].file_b64 = sampleB64;
library[library.length - 1].file_size = SAMPLE_FILE.length * 2;

function fileOf(id: string) {
  const d = library.find((x) => x.id === id);
  if (!d?.file_b64) throw new DemoError(404, "الملف غير موجود");
  return { __file: d.file_b64, mime: d.file_mime ?? "application/octet-stream" };
}

const gov = clone(CONTENT.structure) as { legal_type: string; size: string | null; profile: Record<string, unknown>;
  bodies: DemoBody[]; latest_check: unknown; example_title: string | null };
const oblState = new Map<string, { status: string; note: string | null; source: string }>(
  CONTENT.obligations.map((o) => [o.code, { status: o.status, note: o.note, source: o.source }]));

function activePolicyTypes(): Set<string> {
  return new Set(policies.filter((x) => x.status === "ACTIVE").map((x) => x.policy_type));
}

function recheck(): void {
  const visible = standards.filter((x) => x.is_visible);
  const { results, score } = runCheck(visible, {
    legal_type: gov.legal_type, size: gov.size, profile: gov.profile, bodies: gov.bodies,
    active_policy_types: activePolicyTypes(), ropa_count: ropa.length, doa_count: 0, today: inDays(0),
  });
  const by = new Map(visible.map((x) => [x.code, x]));
  gov.latest_check = {
    id: uid(), created_at: new Date().toISOString(),
    passed: results.filter((r) => r.status === "PASS").length, failed: results.filter((r) => r.status === "FAIL").length,
    not_applicable: results.filter((r) => r.status === "NA").length, structure_score: score,
    results: results.map((r) => ({ ...r, description: by.get(r.code)!.description, legal_reference: by.get(r.code)!.legal_reference,
                                   source_url: by.get(r.code)!.source_url, review_status: by.get(r.code)!.review_status })),
  };
}

function obligationsView() {
  const visible = new Map(obligationCatalog.map((o) => [o.code, o]));
  const active = activePolicyTypes();
  return CONTENT.obligations.filter((o) => visible.get(o.code)?.is_visible).map((o) => {
    const st = oblState.get(o.code)!;
    let eff = st.status;
    let tracked: unknown = st.status === "PENDING" ? o.tracked : null;
    if (st.status === "PENDING" && o.tracked) eff = o.effective_status;
    if (st.status === "PENDING" && !o.tracked && o.policy_type && active.has(o.policy_type)) { eff = "IN_PLACE"; tracked = { type: "POLICY" }; }
    return { ...o, ...st, review_status: visible.get(o.code)!.review_status, tracked, effective_status: eff };
  });
}

// ---------- حماية البيانات (نسخة العرض) ----------
const OWNER_ID = "own-ahmad";
type DemoRopa = { id: string; activity_name: string; purpose: string; data_subjects: string; data_categories: string[];
  includes_sensitive_data: boolean; legal_basis: string; owner_membership_id: string | null; retention_period_months: number;
  storage_location: string; cross_border_transfer: boolean; transfer_destination: string | null; transfer_safeguard: string | null;
  processors: string[]; security_controls: string | null; next_review_date: string | null };
const ropa: DemoRopa[] = [];
const ropaView = (r: DemoRopa) => ({ ...r, owner_name: r.owner_membership_id === OWNER_ID ? "أحمد العتيبي"
  : r.owner_membership_id === "own-reem" ? "ريم السبيعي" : null, updated_at: new Date().toISOString() });
const dsr = [
  { id: uid(), requester_name: "محمد الغامدي", requester_contact: "m.ghamdi@example.sa", request_type: "ACCESS", channel: "EMAIL",
    details: "يطلب نسخة من بياناته المحفوظة لدى المنشأة بصفته عميلاً سابقاً.", received_on: inDays(-22), due_on: inDays(8),
    identity_verified: true, status: "IN_PROGRESS", response_note: null as string | null, completed_on: null as string | null },
  { id: uid(), requester_name: "عبدالله الشمري", requester_contact: "+966500000077", request_type: "DESTRUCTION", channel: "PHONE",
    details: "متقدم سابق لوظيفة يطلب حذف سيرته الذاتية.", received_on: inDays(-40), due_on: inDays(-10), identity_verified: true,
    status: "COMPLETED", response_note: "حُذفت السيرة من بريد التوظيف والأرشيف، وأُبلغ بذلك هاتفياً." as string | null,
    completed_on: inDays(-33) as string | null },
];
const disc0 = new Date(Date.now() - 60 * DAY);
const incidents: { id: string; title: string; description: string | null; discovered_at: string; occurred_at: string | null;
  data_categories: string[]; subjects_affected: number | null; severity: string; harm_likely: boolean; status: string;
  authority_notified_at: string | null; subjects_notified_at: string | null; root_cause: string | null; actions_taken: string | null }[] = [
  { id: uid(), title: "إرسال كشف رواتب لبريد خاطئ", description: "أُرسل كشف رواتب شهر يوليو لعنوان بريد خارجي بالخطأ.",
    discovered_at: disc0.toISOString(), occurred_at: new Date(disc0.getTime() - 3 * 3600e3).toISOString(),
    data_categories: ["الاسم", "الراتب", "الآيبان"], subjects_affected: 18, severity: "MEDIUM", harm_likely: true, status: "CLOSED",
    authority_notified_at: new Date(disc0.getTime() + 30 * 3600e3).toISOString(), subjects_notified_at: new Date(disc0.getTime() + 40 * 3600e3).toISOString(),
    root_cause: "إكمال تلقائي لعنوان البريد في برنامج البريد.",
    actions_taken: "طُلب من المستلم الحذف وأكّد كتابياً، أُبلغت الجهة المختصة والموظفون، وعُطّل الإكمال التلقائي." },
];

// ---------- أدوار فريق حصيف في نسخة العرض (تطابق صلاحيات الخادم) ----------
const TEAM_ROLE: Record<string, "SUPER_ADMIN" | "SUPPORT" | "BILLING"> = {
  "demo-admin": "SUPER_ADMIN", "demo-support": "SUPPORT", "demo-billing": "BILLING",
};
const TEAM_ME: Record<string, { id: string; email: string; full_name: string }> = {
  SUPER_ADMIN: { id: "0a1f5c1e-0000-4000-8000-0000000000b1", email: "admin@haseef.sa", full_name: "فريق عمليات حصيف" },
  SUPPORT: { id: "0a1f5c1e-0000-4000-8000-0000000000b2", email: "support@haseef.sa", full_name: "الدعم الفني" },
  BILLING: { id: "0a1f5c1e-0000-4000-8000-0000000000b3", email: "billing@haseef.sa", full_name: "المحاسبة" },
};
const ROLE_NAME = { SUPER_ADMIN: "المدير العام", SUPPORT: "الدعم الفني", BILLING: "المحاسبة" } as const;
function requireRole(role: keyof typeof ROLE_NAME, method: string, p: string, body: Record<string, unknown>) {
  if (role === "SUPER_ADMIN") return;
  if (method === "GET") {
    // المحاسبة: الفوترة فقط — لا تنبيهات (بيانات تواصل العملاء)، لا فريق، لا محتوى، لا حوكمة المنشآت
    if (role === "BILLING" && (/^\/admin\/(dispatches|team|catalog|library|legal\/lawyers|trial-requests)/.test(p) || /\/governance$/.test(p)))
      throw new DemoError(403, "هذا القسم غير متاح لصلاحية المحاسبة");
    return;
  }
  const deny = (allowed: (keyof typeof ROLE_NAME)[]) => {
    if (!allowed.includes(role)) throw new DemoError(403, `هذا الإجراء متاح لـ: ${["المدير العام", ...allowed.map((r) => ROLE_NAME[r])].join("، ")}`);
  };
  if (/\/(suspend|reactivate)$/.test(p) || p.startsWith("/admin/team") || (method === "DELETE" && p.startsWith("/admin/library"))) return deny([]);
  if ("review_status" in body) throw new DemoError(403, "اعتماد المحتوى أو إعادته لمسودة للمدير العام فقط");
  if (/^\/admin\/legal\/consultations\/[^/]+\/payment$/.test(p) || /^\/admin\/legal\/rates\//.test(p)) return deny(["BILLING"]);
  if (/^\/admin\/legal\/lawyers/.test(p)) return deny([]);
  if (/\/subscription\/extend-trial$/.test(p)) return deny(["BILLING", "SUPPORT"]);
  if (/\/subscription\//.test(p)) return deny(["BILLING"]);
  return deny(["SUPPORT"]);
}

// ---------- طلبات التجربة (نسخة العرض) ----------
type DemoTrial = { id: string; full_name: string; company_name: string; email: string; phone_number: string | null; legal_type: string | null;
  employees_range: string | null; plan_interest: string; interests: string[]; message: string | null; source: string | null;
  status: string; notes: string | null; created_at: string; updated_at: string; handled_by_name: string | null };
const trials: DemoTrial[] = [
  { id: uid(), full_name: "نورة الدوسري", company_name: "شركة مدار للتقنية", email: "noura@madar.example", phone_number: "+966500000031",
    legal_type: "LLC", employees_range: "10-49", plan_interest: "PROFESSIONAL_GRC", interests: ["PDPL", "GOVERNANCE"],
    message: "نحتاج سجل معالجة وسياسة خصوصية قبل إطلاق تطبيقنا.", source: "landing", status: "NEW", notes: null,
    created_at: ago(60 * 3), updated_at: ago(60 * 3), handled_by_name: null },
  { id: uid(), full_name: "فيصل العنزي", company_name: "مؤسسة الإنشاء الحديث", email: "faisal@inshaa.example", phone_number: "+966500000032",
    legal_type: "SOLE_PROPRIETORSHIP", employees_range: "10-49", plan_interest: "ESSENTIAL", interests: ["LICENSES"],
    message: null, source: "landing", status: "CONTACTED", notes: "عرض توضيحي يوم الأحد", created_at: ago(60 * 30), updated_at: ago(60 * 20),
    handled_by_name: "الدعم الفني" },
];

// ---------- الاستشارات القانونية (نسخة العرض) ----------
const LEGAL_RATES = [
  { topic: "CORPORATE", title: "الشركات والحوكمة", description: "عقود التأسيس، قرارات الشركاء والمجالس، تعديل الهيكل، المستفيد الحقيقي.", tier: "GENERAL", hourly_rate_sar: 650, is_active: true },
  { topic: "CONTRACTS", title: "العقود التجارية", description: "مراجعة وصياغة العقود مع العملاء والموردين والمقاولين.", tier: "GENERAL", hourly_rate_sar: 650, is_active: true },
  { topic: "LABOR", title: "العمل والموارد البشرية", description: "عقود العمل، لائحة تنظيم العمل، الإنهاء والمخالصات، النزاعات العمالية.", tier: "GENERAL", hourly_rate_sar: 650, is_active: true },
  { topic: "PDPL", title: "حماية البيانات الشخصية", description: "سياسة الخصوصية، النقل خارج المملكة، حوادث التسرب، عقود المعالجين.", tier: "GENERAL", hourly_rate_sar: 650, is_active: true },
  { topic: "COMPLIANCE", title: "التراخيص والامتثال التنظيمي", description: "متطلبات الجهات الرقابية، المخالفات والغرامات، التظلمات.", tier: "GENERAL", hourly_rate_sar: 650, is_active: true },
  { topic: "RESTRUCTURING", title: "إعادة الهيكلة والاندماج", description: "التحول بين أنواع الشركات، الاندماج والاستحواذ، دخول مستثمر.", tier: "SPECIALIZED", hourly_rate_sar: 950, is_active: true },
  { topic: "DISPUTES", title: "النزاعات والتقاضي والتحكيم", description: "تقييم موقف نزاع قائم، الإنذارات، الاستعداد للتقاضي أو التحكيم.", tier: "SPECIALIZED", hourly_rate_sar: 950, is_active: true },
];
const LAWYERS = [
  { id: "lw-1", full_name: "أ. نوف الحمدان (تجريبي)", license_number: "DEMO-LIC-001", specialties: ["CORPORATE", "RESTRUCTURING"], bio: "حوكمة الشركات وإعادة الهيكلة — 12 سنة خبرة.", email: null, phone_number: null, is_active: true },
  { id: "lw-2", full_name: "أ. ماجد السهلي (تجريبي)", license_number: "DEMO-LIC-002", specialties: ["CONTRACTS", "DISPUTES"], bio: "العقود التجارية والتحكيم — 15 سنة خبرة.", email: null, phone_number: null, is_active: true },
  { id: "lw-3", full_name: "أ. هيا العنزي (تجريبي)", license_number: "DEMO-LIC-003", specialties: ["LABOR", "PDPL", "COMPLIANCE"], bio: "العمل وحماية البيانات والامتثال التنظيمي — 9 سنوات خبرة.", email: null, phone_number: null, is_active: true },
];
const r2 = (x: number) => Math.round(x * 100) / 100;
function legalQuote(rate: number, minutes: number, urgent: boolean, plan: string) {
  if (![30, 60, 90, 120, 180, 240].includes(minutes)) throw new DemoError(422, "مدة غير مدعومة");
  const base = r2(rate * minutes / 60), uPct = urgent ? 30 : 0, urgent_fee = r2(base * uPct / 100);
  const dPct = plan === "ENTERPRISE" ? 25 : plan === "PROFESSIONAL_GRC" ? 15 : 0, discount = r2((base + urgent_fee) * dPct / 100);
  const subtotal = r2(base + urgent_fee - discount), vat = r2(subtotal * 0.15);
  return { hourly_rate: rate, minutes, base, urgent_pct: uPct, urgent_fee, discount_pct: dPct, discount, subtotal, vat_pct: 15, vat, total: r2(subtotal + vat) };
}
type DemoConsult = { id: string; topic: string; subject: string; details: string | null; duration_minutes: number; urgent: boolean;
  mode: string; preferred_at: string; price: ReturnType<typeof legalQuote>; total_sar: number; status: string; lawyer_id: string | null;
  scheduled_at: string | null; meeting_link: string | null; payment_status: string; payment_reference: string | null;
  cancel_reason: string | null; lawyer_summary: string | null; created_at: string };
const consults: DemoConsult[] = [(() => {
  const price = legalQuote(650, 60, false, "PROFESSIONAL_GRC"); const at = new Date(Date.now() + 51 * 3600e3).toISOString();
  return { id: uid(), topic: "LABOR", subject: "إنهاء عقد موظف خلال فترة التجربة",
    details: "موظف في الشهر الثالث من فترة التجربة، نرغب بإنهاء العقد. ما الإجراء الصحيح والمستحقات؟", duration_minutes: 60, urgent: false,
    mode: "VIDEO", preferred_at: at, price, total_sar: price.total, status: "CONFIRMED", lawyer_id: "lw-3", scheduled_at: at,
    meeting_link: "https://meet.example.sa/haseef-demo", payment_status: "PAID", payment_reference: "INV-LEGAL-0001",
    cancel_reason: null, lawyer_summary: null, created_at: ago(60 * 20) };
})()];
const consultView = (c: DemoConsult) => {
  const l = LAWYERS.find((x) => x.id === c.lawyer_id);
  return { ...c, topic_title: LEGAL_RATES.find((r) => r.topic === c.topic)!.title, lawyer_name: l?.full_name ?? null, lawyer_license: l?.license_number ?? null };
};

// ---------- الموجّه ----------
class DemoError extends Error {
  status: number;
  constructor(status: number, msg: string) { super(msg); this.status = status; }
}

// ---------- تقييم الأثر، المنشآت المتعددة، تقرير المجلس، التنبيهات (نسخة العرض) ----------
const DPIA_Q = CONTENT.dpia.questions as DpiaQuestion[];
type DemoDpia = { id: string; project_name: string; description: string | null; related_record_id: string | null;
  answers: Record<string, boolean>; mitigations: DpiaMitigation[]; dpo_opinion: string | null;
  status: "IN_PROGRESS" | "COMPLETED" | "APPROVED"; completed_at: string | null; approved_at: string | null; created_at: string; updated_at: string };
const dpias: DemoDpia[] = [(() => {
  const answers = { sensitive: true, monitoring: true, new_tech: true, processors: true, weak_security: true };
  const mitigations = dpiaSuggest(DPIA_Q, answers).map((x) => ["processors", "weak_security"].includes(x.code) ? { ...x, status: "DONE" as const } : x);
  return { id: uid(), project_name: "نظام الحضور ببصمة الوجه في المواقع",
    description: "استبدال بطاقات الحضور بأجهزة تعرّف على الوجه في 4 مواقع عمل، يديرها مزوّد خارجي.", related_record_id: null,
    answers, mitigations, status: "IN_PROGRESS" as const, completed_at: null, approved_at: null, created_at: ago(60 * 24 * 6), updated_at: ago(60 * 24),
    dpo_opinion: "المعالجة مقبولة بشرط بقاء البيانات داخل المملكة، وإتاحة بديل (بطاقة) لمن يعترض، وحذف القوالب فور انتهاء العلاقة." };
})()];
function dpiaView(d: DemoDpia) {
  const a = dpiaAssess(DPIA_Q, d.answers, d.mitigations);
  const rec = ropa.find((r) => r.id === d.related_record_id);
  return { ...d, questionnaire_version: CONTENT.dpia.version, risk_score: a.score, risk_level: a.level,
           residual_score: a.residual_score, residual_level: a.residual_level, required: a.required, triggers: a.triggers,
           open_mitigations: a.open_mitigations, related_activity: rec?.activity_name ?? null,
           approved_by_name: d.approved_at ? "أحمد العتيبي" : null, created_by_name: "أحمد العتيبي" };
}
function dpiaFromBody(d: DemoDpia, body: Record<string, unknown>) {
  const answers = (body.answers ?? {}) as Record<string, boolean>;
  const unknown = Object.keys(answers).filter((k) => !DPIA_Q.some((q) => q.key === k));
  if (unknown.length) throw new DemoError(422, `أسئلة غير معروفة: ${unknown.join("، ")}`);
  Object.assign(d, { project_name: String(body.project_name ?? d.project_name), description: (body.description as string) ?? null,
    related_record_id: (body.related_record_id as string) ?? null, answers, dpo_opinion: (body.dpo_opinion as string) ?? null,
    mitigations: Array.isArray(body.mitigations) ? body.mitigations as DpiaMitigation[] : dpiaSuggest(DPIA_Q, answers),
    updated_at: new Date().toISOString() });
}

const groupKids = [
  { id: "grp-kid-1", name: "النخبة للتشغيل والصيانة", cr_number: "1010777002", entity_legal_type: "LLC", entity_relation: "SUBSIDIARY" as const,
    commercial_size: "SMALL", haseef_score: 58, items: { expired: 1, expiring: 1, total: 4 }, policies_due: 0,
    obligations: { pending: 9, total: 18 }, open_incidents: 0, structure_score: 71.4 },
  { id: "grp-kid-2", name: "مؤسسة النخبة — فرع جدة", cr_number: "4030777003", entity_legal_type: "SOLE_PROPRIETORSHIP", entity_relation: "BRANCH" as const,
    commercial_size: "SMALL", haseef_score: 81, items: { expired: 0, expiring: 1, total: 3 }, policies_due: 0,
    obligations: { pending: 4, total: 14 }, open_incidents: 0, structure_score: 100 },
];
function groupView() {
  const d = dashboard();
  const chk = gov.latest_check as { structure_score: number | null } | null;
  const obl = obligationsView();
  const main = { id: ORG_A, name: d.org_name, cr_number: d.cr_number, entity_legal_type: gov.legal_type, entity_relation: null,
    commercial_size: "SMALL", haseef_score: d.score.score, score_computed_at: d.score.computed_at, role: "ORG_ADMIN", plan_tier: "ENTERPRISE",
    items: { expired: d.counts.expired, expiring: d.counts.expiring_soon, total: items.length },
    policies_due: policies.map(policyView).filter((x) => x.effective_status === "NEEDS_REVIEW" || x.effective_status === "OVERDUE_REVIEW").length,
    obligations: { pending: obl.filter((o) => o.effective_status === "PENDING").length, total: obl.length },
    open_incidents: incidents.filter((i) => i.status !== "CLOSED").length, structure_score: chk?.structure_score ?? null };
  const entities = [main, ...groupKids.map((k) => ({ ...k, role: "ORG_ADMIN", plan_tier: "ENTERPRISE", score_computed_at: ago(60) }))];
  const scores = entities.map((e) => e.haseef_score).filter((x): x is number => x !== null);
  const sum = (f: (e: typeof entities[number]) => number) => entities.reduce((s, e) => s + f(e), 0);
  return { available: true, root_id: ORG_A, entities, can_manage: true, max_entities: 25, hidden_entities: 0,
    totals: { entities: entities.length, avg_score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      expired: sum((e) => e.items.expired), expiring: sum((e) => e.items.expiring), policies_due: sum((e) => e.policies_due),
      obligations_pending: sum((e) => e.obligations.pending), open_incidents: sum((e) => e.open_incidents) } };
}

const SEV: Record<string, number> = { critical: 0, high: 1, medium: 2, CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
function boardReport(year: number) {
  const d = dashboard();
  const chk = gov.latest_check as { structure_score: number | null; passed: number; failed: number; created_at: string;
    results: { code: string; title: string; message: string; severity: string; level: string; status: string }[] };
  const failed = chk.results.filter((r) => r.status === "FAIL")
    .sort((a, b) => Number(a.level !== "MANDATORY") - Number(b.level !== "MANDATORY") || (SEV[a.severity] ?? 9) - (SEV[b.severity] ?? 9));
  const pol = policies.map(policyView);
  const obl = obligationsView();
  const counts: Record<string, number> = { total: obl.length };
  for (const o of obl) counts[o.effective_status] = (counts[o.effective_status] ?? 0) + 1;
  const pending = obl.filter((o) => o.effective_status === "PENDING" || o.effective_status === "AT_RISK")
    .sort((a, b) => (SEV[String(a.risk_level)] ?? 9) - (SEV[String(b.risk_level)] ?? 9)).slice(0, 10);
  const attention = itemViews().filter((i) => i.status !== "ACTIVE").slice(0, 10).map((i) => ({ title: i.title, expiry_date: i.expiry_date, risk_level: i.risk_level }));
  const inYear = (x: string) => x.slice(0, 4) === String(year);
  const recs: { priority: string; area: string; text: string }[] = [
    ...failed.slice(0, 6).map((r) => ({ priority: r.severity.toUpperCase(), area: "الحوكمة", text: `${r.title}: ${r.message}` })),
    ...pending.slice(0, 4).map((x) => ({ priority: String(x.risk_level), area: "الالتزامات", text: `استكمال: ${x.title}` })),
    ...attention.filter((x) => x.risk_level !== "MEDIUM").map((x) => ({ priority: x.risk_level, area: "التراخيص", text: `تجديد ${x.title} (ينتهي/انتهى ${x.expiry_date})` })),
  ].sort((a, b) => (SEV[a.priority] ?? 9) - (SEV[b.priority] ?? 9));
  const dv = dpias.map(dpiaView);
  return {
    year, generated_on: inDays(0),
    org: { name: d.org_name, cr_number: d.cr_number, entity_legal_type: gov.legal_type, industry_type: "المقاولات", commercial_size: "SMALL" },
    plan: { tier: "ENTERPRISE", name: "باقة كبار العملاء" },
    score: { value: d.score.score, pillars: d.score.pillars, reasons: d.score.reasons.slice(0, 8), computed_at: d.score.computed_at },
    structure: gov.bodies.map((b) => ({ name: b.name, body_type: b.body_type, meetings_per_year: b.meetings_per_year,
      members: b.members.map((x) => ({ full_name: x.full_name, position: x.position, is_independent: x.is_independent, is_executive: x.is_executive, term_ends_on: x.term_ends_on })) })),
    governance_check: { structure_score: chk.structure_score, passed: chk.passed, failed: chk.failed, run_at: chk.created_at,
      failed_items: failed.slice(0, 12).map((r) => ({ code: r.code, title: r.title, message: r.message, severity: r.severity, level: r.level })) },
    resolutions: { total: 3, by_type: { PARTNERS_DECISION: 2, MANAGER_DECISION: 1 }, list: [
      { title: "اعتماد القوائم المالية وتعيين المراجع الخارجي", resolution_type: "PARTNERS_DECISION", meeting_date: `${year}-04-20`, status: "SIGNED" },
      { title: "اعتماد مصفوفة الصلاحيات المحدثة", resolution_type: "MANAGER_DECISION", meeting_date: `${year}-06-02`, status: "SIGNED" },
      { title: "الموافقة على فتح فرع جدة", resolution_type: "PARTNERS_DECISION", meeting_date: `${year}-08-15`, status: "CIRCULATED" } ] },
    meetings: gov.bodies.filter((b) => b.meetings_per_year).map((b) => ({ body: b.name, body_type: b.body_type, required: b.meetings_per_year!,
      held: b.body_type === "PARTNERS_ASSEMBLY" ? 2 : null })),
    compliance: { active: d.counts.active, expiring: d.counts.expiring_soon, expired: d.counts.expired, total: items.length, renewed_in_year: 2, attention },
    policies: { active: pol.filter((x) => x.status === "ACTIVE").length, overdue: pol.filter((x) => x.effective_status === "OVERDUE_REVIEW").length,
      needs_review: pol.filter((x) => x.effective_status === "NEEDS_REVIEW").length, drafts: pol.filter((x) => x.status === "DRAFT").length,
      approved_in_year: pol.filter((x) => x.approval_date && inYear(x.approval_date)).length },
    obligations: { counts, pending: pending.map((x) => ({ title: String(x.title), risk_level: String(x.risk_level), authority: (x.authority as string) ?? null })) },
    pdpl: { records: ropa.length,
      requests: { total: dsr.filter((r) => inYear(r.received_on)).length, on_time: dsr.filter((r) => r.status === "COMPLETED").length,
        open: dsr.filter((r) => r.status === "OPEN" || r.status === "IN_PROGRESS").length },
      incidents: { total: incidents.filter((i) => inYear(i.discovered_at)).length, notified_in_time: incidents.filter((i) => i.authority_notified_at).length,
        harm_likely: incidents.filter((i) => i.harm_likely).length, open: incidents.filter((i) => i.status !== "CLOSED").length },
      dpia: { total: dv.length, approved: dv.filter((x) => x.status === "APPROVED").length, high_residual: dv.filter((x) => x.residual_level === "HIGH" || x.residual_level === "CRITICAL").length } },
    legal: { completed: consults.filter((c) => c.status === "COMPLETED").length, open: consults.filter((c) => c.status === "REQUESTED" || c.status === "CONFIRMED").length },
    recommendations: recs.slice(0, 12),
  };
}
const savedReports = new Map<number, { snapshot: ReturnType<typeof boardReport>; notes: string | null; saved_at: string; saved_by_name: string }>();

const alertRules: Record<"COMPLIANCE_ITEM" | "POLICY", { target_type: string; days_before: number[]; channels: string[]; is_enabled: boolean; is_default: boolean }> = {
  COMPLIANCE_ITEM: { target_type: "COMPLIANCE_ITEM", days_before: [60, 30, 14, 7, 3, 1, 0], channels: ["WHATSAPP", "EMAIL"], is_enabled: true, is_default: true },
  POLICY: { target_type: "POLICY", days_before: [30, 14, 7, 0], channels: ["EMAIL", "WHATSAPP"], is_enabled: true, is_default: true },
};
const recipients = [
  { membership_id: "rcp-ahmad", full_name: "أحمد العتيبي", email: "demo@haseef.sa", phone: "+966500000001", role: "ORG_ADMIN", receives_alerts: true, alert_channels: ["EMAIL", "WHATSAPP"], is_me: true },
  { membership_id: "rcp-reem", full_name: "ريم السبيعي", email: "reem@nukhba.example", phone: "+966500000011", role: "DPO", receives_alerts: true, alert_channels: ["EMAIL"], is_me: false },
  { membership_id: "rcp-adv", full_name: "مكتب المستشار القانوني", email: "advisor@example.sa", phone: null, role: "EXTERNAL_ADVISOR", receives_alerts: false, alert_channels: [], is_me: false },
];
function alertsOverview() {
  const today = riyadhToday().getTime();
  const upcoming: { target_type: string; target_id: string; title: string; due_date: string; alert_on: string; threshold_days: number; channels: string[] }[] = [];
  const add = (type: "COMPLIANCE_ITEM" | "POLICY", id: string, title: string, due: string) => {
    const rule = alertRules[type];
    if (!rule.is_enabled) return;
    const left = daysLeft(due);
    const t = [...rule.days_before].sort((a, b) => b - a).find((x) => x <= left);
    if (t === undefined) return;
    const on = iso(new Date(new Date(`${due}T00:00:00Z`).getTime() - t * DAY));
    if (new Date(`${on}T00:00:00Z`).getTime() - today <= 60 * DAY) upcoming.push({ target_type: type, target_id: id, title, due_date: due, alert_on: on, threshold_days: t, channels: rule.channels });
  };
  for (const i of items) add("COMPLIANCE_ITEM", i.id, i.title, i.expiry_date);
  for (const x of policies) if (x.status === "ACTIVE") add("POLICY", x.id, x.title, x.review_due_date);
  upcoming.sort((a, b) => a.alert_on.localeCompare(b.alert_on));
  const log = dispatches().items.filter((x) => x.org_name === "مؤسسة النخبة للمقاولات").map((x, k) => ({
    id: x.id, target_type: x.target_type, title: items[k % items.length]?.title ?? null, due_date: x.due_date, threshold_days: x.threshold_days,
    channel: x.channel, status: x.status, skip_reason: null, scheduled_for: x.scheduled_for, sent_at: x.sent_at, delivered_at: x.delivered_at,
    recipient_name: x.channel === "WHATSAPP" || x.recipient_address === "demo@haseef.sa" ? "أحمد العتيبي" : "مكتب المستشار القانوني" }));
  return { plan: { tier: "PROFESSIONAL_GRC", name: "باقة الحوكمة والنمو", active: true },
    whatsapp: { provider: "console", live: false, limit: 1000, used: 37, remaining: 963 }, send_hour: 9,
    rules: alertRules, custom_rules: 0, recipients, upcoming: upcoming.slice(0, 50), log, can_manage: true };
}

const findOrg = (id: string) => { const o = orgs.find((x) => x.id === id); if (!o) throw new DemoError(404, "المنشأة غير موجودة"); return o; };
const TEMP_PW = "Demo-Temp-2026";

function route(method: string, path: string, body: Record<string, unknown>, token: string | null): unknown {
  const p = path.split("?")[0];
  const q = new URLSearchParams(path.split("?")[1] ?? "");
  let m: RegExpMatchArray | null;

  if (method === "POST" && p === "/auth/login") {
    const u = DEMO_USERS[String(body.email ?? "").trim().toLowerCase()];
    if (!u || u.password !== body.password) throw new DemoError(401, "البريد أو كلمة المرور غير صحيحة");
    return { access_token: u.token, token_type: "bearer", must_change_password: false };
  }
  if (method === "POST" && p === "/public/trial-requests") {
    if (!body.consent) throw new DemoError(422, "يلزم الموافقة على التواصل ومعالجة البيانات");
    if (!/^\S+@\S+\.\S+$/.test(String(body.email ?? ""))) throw new DemoError(422, "البريد الإلكتروني غير صحيح");
    if (String(body.full_name ?? "").trim().length < 2 || String(body.company_name ?? "").trim().length < 2) throw new DemoError(422, "أكمل الاسم واسم المنشأة");
    if (!body.website) trials.unshift({ id: uid(), full_name: String(body.full_name), company_name: String(body.company_name), email: String(body.email),
      phone_number: (body.phone_number as string) ?? null, legal_type: (body.legal_type as string) ?? null, employees_range: (body.employees_range as string) ?? null,
      plan_interest: String(body.plan_interest ?? "UNSURE"), interests: (body.interests as string[]) ?? [], message: (body.message as string) ?? null,
      source: (body.source as string) ?? "landing", status: "NEW", notes: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), handled_by_name: null });
    return { received: true };
  }
  if (!token) throw new DemoError(401, "سجّل الدخول أولاً");
  const role = TEAM_ROLE[token];
  const isAdmin = !!role;
  if (p === "/auth/me") return isAdmin ? { ...ADMIN_ME, ...TEAM_ME[role] } : CLIENT_ME;
  if (p === "/auth/change-password") return undefined;

  if (p.startsWith("/admin")) {
    if (!isAdmin) throw new DemoError(403, "هذه الواجهة لفريق حصيف فقط");
    if (p === "/admin/me") return { user_id: TEAM_ME[role].id, role };
    requireRole(role, method, p, body);
    if (p === "/admin/overview") { const ov = overview(); return role === "SUPPORT" ? { ...ov, kpis: { ...ov.kpis, mrr_sar: null } } : ov; }
    if (p === "/admin/organizations" && method === "GET") return orgs.map(orgRow);
    if (p === "/admin/organizations" && method === "POST") {
      const o: Org = { id: uid(), name: String(body.name), cr: String(body.cr_number), legal: String(body.entity_legal_type), industry: String(body.industry_type ?? "—"),
        size: String(body.commercial_size ?? "SMALL"), score: null, suspended_at: null, reason: null, created_at: new Date().toISOString(),
        sub: { id: uid(), plan_tier: String(body.plan_tier), billing_cycle: "MONTHLY", billing_status: "TRIAL", starts_at: new Date().toISOString(), ends_at: ts(Number(body.trial_days) || 14) },
        members: [{ membership_id: uid(), role: "ORG_ADMIN", user_id: uid(), full_name: String(body.admin_full_name), email: String(body.admin_email), phone: null, active: true, last: null }],
        billing: [], counts: { items: 0, expired: 0, policies: 0 } };
      orgs.unshift(o); log("ADMIN_CREATE_ORG", o, { name: o.name, cr_number: o.cr });
      // نسخة العرض صفحات ثابتة: تُفتح صفحة منشأة موجودة بدل صفحة جديدة لا ملف لها.
      return { id: ORG_C, temporary_password: TEMP_PW, admin_existing_user: false };
    }
    if ((m = p.match(/^\/admin\/organizations\/([^/]+)$/))) {
      const o = findOrg(m[1]);
      if (method === "GET") {
        const full = orgDetail(o);
        if (role === "SUPPORT") return { ...full, restricted: false,
          subscription: full.subscription && (({ monthly_price_sar: _m, yearly_price_sar: _y, ...rest }) => rest)(full.subscription),
          billing: full.billing.map((b) => ({ ...b, amount_sar: null, reference: null })) };
        if (role !== "BILLING") return { ...full, restricted: false };
        const { haseef_score: _s, suspension_reason: _r, ...org } = full.organization;
        return { ...full, organization: org, counts: null, restricted: true,
                 members: full.members.filter((x) => x.role === "ORG_ADMIN" && x.membership_active)
                   .map((x) => ({ membership_id: x.membership_id, role: x.role, full_name: x.full_name, email: x.email,
                                  membership_active: x.membership_active, user_active: x.user_active })) };
      }
      Object.assign(o, { name: body.name ?? o.name, industry: body.industry_type ?? o.industry });
      log("ADMIN_UPDATE_ORG", o, body); return { updated: true };
    }
    if ((m = p.match(/^\/admin\/organizations\/([^/]+)\/(suspend|reactivate)$/))) {
      const o = findOrg(m[1]);
      if (m[2] === "suspend") { o.suspended_at = new Date().toISOString(); o.reason = String(body.reason); log("ADMIN_SUSPEND_ORG", o, { reason: body.reason }); return { suspended: true, canceled_alerts: 0 }; }
      o.suspended_at = null; o.reason = null; log("ADMIN_REACTIVATE_ORG", o, { reason: body.reason }); return { suspended: false };
    }
    if ((m = p.match(/^\/admin\/organizations\/([^/]+)\/subscription\/([a-z-]+)$/))) {
      const o = findOrg(m[1]); const s = o.sub; if (!s) throw new DemoError(404, "لا يوجد اشتراك");
      const now = new Date().toISOString();
      if (m[2] === "change-plan") {
        if (body.plan_tier === s.plan_tier) throw new DemoError(409, "المنشأة على هذه الباقة أصلاً");
        log("ADMIN_CHANGE_PLAN", o, { from: s.plan_tier, to: body.plan_tier }); s.plan_tier = String(body.plan_tier);
        o.billing.unshift({ event_type: "PLAN_CHANGED", plan_tier: s.plan_tier, amount_sar: null, period_months: null, reference: null, note: (body.note as string) ?? null, created_at: now, actor: "فريق عمليات حصيف" });
        return { plan_tier: s.plan_tier };
      }
      if (m[2] === "extend-trial") {
        if (s.billing_status !== "TRIAL") throw new DemoError(409, "المنشأة ليست في فترة تجريبية");
        s.ends_at = new Date(new Date(s.ends_at).getTime() + Number(body.days) * DAY).toISOString();
        o.billing.unshift({ event_type: "TRIAL_EXTENDED", plan_tier: s.plan_tier, amount_sar: null, period_months: null, reference: null, note: `${body.days} يوماً`, created_at: now, actor: "فريق عمليات حصيف" });
        log("ADMIN_EXTEND_TRIAL", o, { days: body.days }); return { ends_at: s.ends_at };
      }
      if (m[2] === "payment") {
        const months = body.billing_cycle === "YEARLY" ? 12 : 1;
        const base = s.billing_status === "TRIAL" ? Date.now() : Math.max(Date.now(), new Date(s.ends_at).getTime());
        const end = new Date(base); end.setMonth(end.getMonth() + months);
        Object.assign(s, { billing_status: "ACTIVE", billing_cycle: body.billing_cycle, plan_tier: body.plan_tier ?? s.plan_tier, ends_at: end.toISOString() });
        o.billing.unshift({ event_type: "PAYMENT", plan_tier: s.plan_tier, amount_sar: Number(body.amount_sar), period_months: months, reference: (body.reference as string) ?? null, note: (body.note as string) ?? null, created_at: now, actor: "فريق عمليات حصيف" });
        log("ADMIN_RECORD_PAYMENT", o, { amount_sar: body.amount_sar, cycle: body.billing_cycle, reference: body.reference }); return { status: "ACTIVE" };
      }
      if (m[2] === "cancel") {
        s.billing_status = "CANCELED";
        o.billing.unshift({ event_type: "CANCELED", plan_tier: s.plan_tier, amount_sar: null, period_months: null, reference: null, note: String(body.reason), created_at: now, actor: "فريق عمليات حصيف" });
        log("ADMIN_CANCEL_SUBSCRIPTION", o, { reason: body.reason }); return { status: "CANCELED" };
      }
    }
    if ((m = p.match(/^\/admin\/organizations\/([^/]+)\/members$/))) {
      const o = findOrg(m[1]);
      o.members.push({ membership_id: uid(), role: String(body.role), user_id: uid(), full_name: String(body.full_name), email: String(body.email), phone: (body.phone_number as string) ?? null, active: true, last: null });
      log("ADMIN_INVITE_MEMBER", o, { email: body.email, role: body.role }); return { temporary_password: TEMP_PW, existing_user: false };
    }
    if ((m = p.match(/^\/admin\/memberships\/([^/]+)$/))) {
      for (const o of orgs) for (const mem of o.members) if (mem.membership_id === m[1]) {
        if (body.role) mem.role = String(body.role);
        if (typeof body.is_active === "boolean") mem.active = body.is_active;
        log("ADMIN_UPDATE_MEMBERSHIP", o, body);
      }
      return { updated: true };
    }
    if ((m = p.match(/^\/admin\/users\/([^/]+)\/(reset-password|disable|enable)$/))) {
      for (const o of orgs) for (const mem of o.members) if (mem.user_id === m[1] && m[2] !== "reset-password") mem.active = m[2] === "enable";
      log(m[2] === "reset-password" ? "ADMIN_RESET_PASSWORD" : m[2] === "disable" ? "ADMIN_DISABLE_USER" : "ADMIN_ENABLE_USER", null, body.reason ? { reason: body.reason } : null);
      return m[2] === "reset-password" ? { temporary_password: TEMP_PW } : { is_active: m[2] === "enable" };
    }
    if (p === "/admin/team" && method === "GET") return team.filter((t) => t.platform_role);
    if (p === "/admin/team" && method === "POST") {
      team.push({ id: uid(), full_name: String(body.full_name), email: String(body.email), platform_role: String(body.role), is_active: true, last_login_at: null, must_change_password: true });
      log("ADMIN_TEAM_ADD", null, { email: body.email, role: body.role }); return { temporary_password: TEMP_PW };
    }
    if ((m = p.match(/^\/admin\/team\/([^/]+)$/))) {
      if (m[1] === ADMIN_ME.id) throw new DemoError(409, "لا يمكنك تغيير دورك بنفسك");
      const t = team.find((x) => x.id === m![1]); if (!t) throw new DemoError(404, "العضو غير موجود");
      log("ADMIN_TEAM_ROLE", null, { from: t.platform_role, to: body.role });
      if (body.role) t.platform_role = String(body.role); else team.splice(team.indexOf(t), 1);
      return { role: body.role ?? null };
    }
    if (p === "/admin/catalog/standards") return standards;
    if (p === "/admin/catalog/obligations") return obligationCatalog.map((o) => ({ ...o, orgs: oblState.has(o.code) ? 1 : 0 }));
    if ((m = p.match(/^\/admin\/catalog\/(standards|obligations)\/([^/]+)$/)) && method === "PATCH") {
      const coll: { code: string }[] = m[1] === "standards" ? standards : obligationCatalog;
      const row = coll.find((x) => x.code === m![2]); if (!row) throw new DemoError(404, "العنصر غير موجود");
      Object.assign(row, pick(body, ["is_visible", "review_status", "title", "description", "legal_reference", "source_url"]), { updated_at: new Date().toISOString() });
      log(m[1] === "standards" ? "ADMIN_CATALOG_STANDARD" : "ADMIN_CATALOG_OBLIGATION", null, { key: m[2], ...body });
      if (m[1] === "standards") recheck();
      return { updated: true };
    }
    if (p === "/admin/catalog/obligations" && method === "POST") throw new DemoError(403, "إضافة التزام جديد متاحة في النسخة الفعلية");
    if (p === "/admin/library" && method === "GET") return library.map((d) => ({ ...d, created_by_name: d.created_by_name ?? "فريق حصيف",
      updated_by_name: null, adoptions: policies.filter((x) => x.source === d.id).length }));
    if (p === "/admin/library" && method === "POST") {
      const id = uid();
      const kind = String(body.kind) as LibDoc["kind"];
      library.unshift({ id, slug: null, kind, category: String(body.category), title: String(body.title), summary: (body.summary as string) ?? null,
        url: (body.url as string) ?? null, body_md: (body.body_md as string) ?? null, policy_type: null,
        file_name: kind === "FILE" ? String(body.file_name) : null, file_mime: kind === "FILE" ? String(body.file_mime || "application/octet-stream") : null,
        file_size: kind === "FILE" ? Math.round(String(body.file_base64 ?? "").length * 0.75) : null, file_b64: (body.file_base64 as string) ?? null,
        applies_legal_types: (body.applies_legal_types as string[]) ?? [], related_codes: [], review_status: "DRAFT", version: "1.0",
        is_visible: true, min_plan: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by_name: "فريق عمليات حصيف" });
      log("ADMIN_LIBRARY_ADD", null, { title: body.title, kind });
      return { id };
    }
    if ((m = p.match(/^\/admin\/library\/([^/]+)\/file$/))) return fileOf(m[1]);
    if ((m = p.match(/^\/admin\/library\/([^/]+)$/))) {
      const k = library.findIndex((d) => d.id === m![1]); if (k < 0) throw new DemoError(404, "المستند غير موجود");
      if (method === "GET") return library[k];
      if (method === "DELETE") { log("ADMIN_LIBRARY_DELETE", null, { title: library[k].title }); library.splice(k, 1); return undefined; }
      Object.assign(library[k], pick(body, ["is_visible", "review_status", "title", "summary", "body_md", "url", "category"]), { updated_at: new Date().toISOString() });
      log("ADMIN_LIBRARY_EDIT", null, { title: library[k].title, ...pick(body, ["is_visible", "review_status"]) });
      return { updated: true };
    }
    if ((m = p.match(/^\/admin\/organizations\/([^/]+)\/governance$/))) {
      const obl = obligationsView();
      const openR = dsr.filter((r) => r.status === "OPEN" || r.status === "IN_PROGRESS");
      return { bodies: gov.bodies, latest_check: gov.latest_check,
               pdpl: { records: ropa.length, requests_open: openR.length, requests_overdue: openR.filter((r) => daysLeft(r.due_on) < 0).length,
                       incidents_open: incidents.filter((i) => i.status !== "CLOSED").length,
                       incidents_notify_overdue: incidents.filter((i) => i.harm_likely && !i.authority_notified_at && i.status !== "CLOSED"
                         && Date.now() > new Date(i.discovered_at).getTime() + 72 * 3600e3).length },
               obligations: { total: obl.length, in_place: obl.filter((o) => o.effective_status === "IN_PLACE").length,
                              pending: obl.filter((o) => o.effective_status === "PENDING" || o.effective_status === "AT_RISK").length } };
    }
    if (p === "/admin/legal/consultations") return consults.map((c) => ({ ...consultView(c), org_name: "مؤسسة النخبة للمقاولات", org_id: ORG_A,
      requested_by_name: "أحمد العتيبي", details: role === "BILLING" ? null : c.details, lawyer_summary: role === "BILLING" ? null : c.lawyer_summary }))
      .sort((a, b) => Number(["COMPLETED", "CANCELED"].includes(a.status)) - Number(["COMPLETED", "CANCELED"].includes(b.status)));
    if ((m = p.match(/^\/admin\/legal\/consultations\/([^/]+)\/(assign|complete|cancel|payment)$/))) {
      const c = consults.find((x) => x.id === m![1]); if (!c) throw new DemoError(404, "الطلب غير موجود");
      if (m[2] === "assign") { Object.assign(c, { lawyer_id: body.lawyer_id, scheduled_at: body.scheduled_at, meeting_link: body.meeting_link ?? null, status: "CONFIRMED" }); return { status: "CONFIRMED" }; }
      if (m[2] === "complete") { if (c.status !== "CONFIRMED") throw new DemoError(409, "الاستشارة غير مؤكدة"); Object.assign(c, { status: "COMPLETED", lawyer_summary: body.lawyer_summary ?? null }); return { status: "COMPLETED" }; }
      if (m[2] === "cancel") { Object.assign(c, { status: "CANCELED", cancel_reason: body.reason }); return { status: "CANCELED" }; }
      Object.assign(c, { payment_status: body.payment_status, payment_reference: body.payment_reference }); return { payment_status: body.payment_status };
    }
    if (p === "/admin/legal/rates") return LEGAL_RATES;
    if ((m = p.match(/^\/admin\/legal\/rates\/([^/]+)$/))) {
      const r = LEGAL_RATES.find((x) => x.topic === m![1]); if (!r) throw new DemoError(404, "المجال غير موجود");
      Object.assign(r, { hourly_rate_sar: Number(body.hourly_rate_sar), is_active: !!body.is_active }); return { updated: true };
    }
    if (p === "/admin/legal/lawyers" && method === "GET") return LAWYERS;
    if (p === "/admin/legal/lawyers" && method === "POST") { const id = uid(); LAWYERS.push({ ...(body as unknown as typeof LAWYERS[number]), id }); return { id }; }
    if ((m = p.match(/^\/admin\/legal\/lawyers\/([^/]+)$/))) { const l = LAWYERS.find((x) => x.id === m![1]); if (l) Object.assign(l, body, { id: l.id }); return { updated: true }; }
    if (p === "/admin/audit") {
      const id = q.get("org_id");
      const billingOnly = ["ADMIN_RECORD_PAYMENT", "ADMIN_CHANGE_PLAN", "ADMIN_EXTEND_TRIAL", "ADMIN_CANCEL_SUBSCRIPTION",
                           "ADMIN_CREATE_ORG", "ADMIN_SUSPEND_ORG", "ADMIN_REACTIVATE_ORG"];
      return audit.filter((a) => (!id || a.org_id === id) && (role !== "BILLING" || billingOnly.includes(a.action)))
        .map((a) => role === "SUPPORT" && a.changes ? { ...a, changes: Object.fromEntries(Object.entries(a.changes).filter(([k]) => k !== "amount_sar" && k !== "reference")) } : a);
    }
    if (p === "/admin/dispatches") return dispatches();
    if (p === "/admin/trial-requests") return trials;
    if ((m = p.match(/^\/admin\/trial-requests\/([^/]+)$/))) {
      const t = trials.find((x) => x.id === m![1]); if (!t) throw new DemoError(404, "الطلب غير موجود");
      Object.assign(t, { status: String(body.status), notes: (body.notes as string) ?? null, updated_at: new Date().toISOString(),
        handled_by_name: ROLE_NAME[role] }); return { updated: true };
    }
    if (p === "/admin/ai-usage") return orgs.map((o) => ({ org_id: o.id, name: o.name, plan_tier: o.sub?.plan_tier ?? null,
      quota: o.sub?.plan_tier === "ESSENTIAL" ? 3 : 15, audits_this_month: o.id === ORG_A ? 4 : 0, tokens: o.id === ORG_A ? 48_200 : 0, cost_sar: role === "SUPPORT" ? null : o.id === ORG_A ? 3.6 : 0 }));
    throw new DemoError(404, "غير متاح في نسخة العرض");
  }

  // واجهة العميل — الحوكمة والالتزامات والمكتبة (بيانات ثابتة من demo-content.json)
  if (p === "/governance/structure" && method === "GET") return gov;
  if (p === "/governance/check") { if (method === "POST") recheck(); return gov.latest_check; }
  if (p === "/governance/structure/apply-template") {
    const have = new Set(gov.bodies.map((b) => b.body_type));
    const add = (CONTENT.templates[gov.legal_type as keyof typeof CONTENT.templates] ?? []).filter((b) => !have.has(b.body_type));
    gov.bodies.push(...add.map((b) => ({ ...clone(b), id: uid(), sort: 900 + b.sort })));
    recheck(); return { bodies_added: add.length };
  }
  if (p === "/governance/structure/apply-example") {
    const ex = CONTENT.examples[gov.legal_type as keyof typeof CONTENT.examples];
    gov.bodies = clone(ex.bodies).map((b) => ({ ...b, id: uid(), members: b.members.map((x) => ({ ...x, id: uid() })) }));
    recheck(); return { bodies: gov.bodies.length };
  }
  if (p === "/governance/profile") { Object.assign(gov.profile, body); recheck(); return gov.profile; }
  if (p === "/governance/bodies" && method === "POST") {
    const id = uid();
    gov.bodies.push({ id, body_type: String(body.body_type), name: String(body.name), mandate: (body.mandate as string) ?? null,
                      meetings_per_year: (body.meetings_per_year as number) ?? null, sort: 1000, from_template: false, members: [] });
    recheck(); return { id };
  }
  if ((m = p.match(/^\/governance\/bodies\/([^/]+)\/members$/))) {
    const b = gov.bodies.find((x) => x.id === m![1]); if (!b) throw new DemoError(404, "الجهاز غير موجود");
    if (body.is_independent && body.is_executive) throw new DemoError(422, "لا يكون العضو مستقلاً وتنفيذياً في الوقت نفسه");
    const id = uid(); b.members.push({ id, ...(pick(body, MEMBER_KEYS) as Omit<DemoMember, "id">) }); recheck(); return { id };
  }
  if ((m = p.match(/^\/governance\/bodies\/([^/]+)$/))) {
    const k = gov.bodies.findIndex((x) => x.id === m![1]); if (k < 0) throw new DemoError(404, "الجهاز غير موجود");
    if (method === "DELETE") gov.bodies.splice(k, 1);
    else Object.assign(gov.bodies[k], pick(body, ["body_type", "name", "mandate", "meetings_per_year"]));
    recheck(); return method === "DELETE" ? undefined : { updated: true };
  }
  if ((m = p.match(/^\/governance\/members\/([^/]+)$/))) {
    for (const b of gov.bodies) {
      const k = b.members.findIndex((x) => x.id === m![1]);
      if (k < 0) continue;
      if (method === "DELETE") b.members.splice(k, 1);
      else {
        if (body.is_independent && body.is_executive) throw new DemoError(422, "لا يكون العضو مستقلاً وتنفيذياً في الوقت نفسه");
        Object.assign(b.members[k], pick(body, MEMBER_KEYS));
      }
      recheck(); return method === "DELETE" ? undefined : { updated: true };
    }
    throw new DemoError(404, "العضو غير موجود");
  }
  // ---------- الاستشارات القانونية
  if (p === "/legal/rates") return { rates: LEGAL_RATES.filter((r) => r.is_active), durations: [30, 60, 90, 120, 180, 240], vat_pct: 15,
    urgent_pct: 30, plan_tier: "PROFESSIONAL_GRC", plan_discount_pct: 15 };
  if (p === "/legal/quote") {
    const r = LEGAL_RATES.find((x) => x.topic === body.topic && x.is_active); if (!r) throw new DemoError(404, "المجال غير متاح");
    return legalQuote(r.hourly_rate_sar, Number(body.duration_minutes), !!body.urgent, "PROFESSIONAL_GRC");
  }
  if (p === "/legal/consultations" && method === "GET") return consults.map(consultView).sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (p === "/legal/consultations" && method === "POST") {
    const r = LEGAL_RATES.find((x) => x.topic === body.topic && x.is_active); if (!r) throw new DemoError(404, "المجال غير متاح");
    const pref = new Date(String(body.preferred_at));
    if (pref.getTime() < Date.now() + 2 * 3600e3) throw new DemoError(422, "اختر موعداً بعد ساعتين على الأقل من الآن");
    if (body.urgent && pref.getTime() > Date.now() + 48 * 3600e3) throw new DemoError(422, "الاستشارة العاجلة تكون خلال 48 ساعة");
    const price = legalQuote(r.hourly_rate_sar, Number(body.duration_minutes), !!body.urgent, "PROFESSIONAL_GRC");
    const id = uid();
    consults.push({ id, topic: r.topic, subject: String(body.subject), details: (body.details as string) ?? null, duration_minutes: Number(body.duration_minutes),
      urgent: !!body.urgent, mode: String(body.mode ?? "VIDEO"), preferred_at: pref.toISOString(), price, total_sar: price.total, status: "REQUESTED",
      lawyer_id: null, scheduled_at: null, meeting_link: null, payment_status: "UNPAID", payment_reference: null, cancel_reason: null,
      lawyer_summary: null, created_at: new Date().toISOString() });
    return { id, total_sar: price.total };
  }
  if ((m = p.match(/^\/legal\/consultations\/([^/]+)\/cancel$/))) {
    const c = consults.find((x) => x.id === m![1]); if (!c) throw new DemoError(404, "الطلب غير موجود");
    if (!["REQUESTED", "CONFIRMED"].includes(c.status)) throw new DemoError(409, "لا يمكن إلغاء هذا الطلب");
    if (c.status === "CONFIRMED" && c.scheduled_at && new Date(c.scheduled_at).getTime() < Date.now() + 24 * 3600e3)
      throw new DemoError(409, "لا يُلغى الموعد المؤكد قبل أقل من 24 ساعة. تواصل مع فريق حصيف.");
    Object.assign(c, { status: "CANCELED", cancel_reason: String(body.reason) }); return { status: "CANCELED" };
  }

  // ---------- تقييم الأثر
  if (p === "/pdpl/dpia/questionnaire") return { version: CONTENT.dpia.version, levels: CONTENT.dpia.levels, questions: DPIA_Q };
  if (p === "/pdpl/dpia" && method === "GET") return dpias.map(dpiaView);
  if (p === "/pdpl/dpia" && method === "POST") {
    const d: DemoDpia = { id: uid(), project_name: "", description: null, related_record_id: null, answers: {}, mitigations: [], dpo_opinion: null,
      status: "IN_PROGRESS", completed_at: null, approved_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    dpiaFromBody(d, body); dpias.unshift(d); return dpiaView(d);
  }
  if ((m = p.match(/^\/pdpl\/dpia\/([^/]+)\/status$/))) {
    const d = dpias.find((x) => x.id === m![1]); if (!d) throw new DemoError(404, "التقييم غير موجود");
    if (d.status === "APPROVED") throw new DemoError(409, "التقييم معتمد مسبقاً");
    const st = String(body.status) as DemoDpia["status"];
    if (st !== "IN_PROGRESS" && !(Object.keys(d.answers).length && d.dpo_opinion)) throw new DemoError(422, "أكمل الإجابات ورأي مسؤول حماية البيانات قبل الإنهاء");
    if (st === "APPROVED") {
      if (d.status !== "COMPLETED") throw new DemoError(422, "يُعتمد التقييم بعد إنهائه");
      if (dpiaView(d).residual_level === "CRITICAL") throw new DemoError(422, "الخطر المتبقي حرج: نفّذ المعالجات أو استشر الجهة المختصة قبل الاعتماد");
    }
    d.status = st; d.completed_at = st === "IN_PROGRESS" ? null : (d.completed_at ?? new Date().toISOString());
    d.approved_at = st === "APPROVED" ? new Date().toISOString() : null; return dpiaView(d);
  }
  if ((m = p.match(/^\/pdpl\/dpia\/([^/]+)$/))) {
    const k = dpias.findIndex((x) => x.id === m![1]); if (k < 0) throw new DemoError(404, "التقييم غير موجود");
    const d = dpias[k];
    if (method === "GET") return dpiaView(d);
    if (d.status === "APPROVED") throw new DemoError(409, "التقييم معتمد ولا يُعدَّل. أنشئ تقييماً جديداً للتغيير.");
    if (method === "DELETE") { dpias.splice(k, 1); return undefined; }
    dpiaFromBody(d, body); return dpiaView(d);
  }

  // ---------- المنشآت المتعددة وتقرير المجلس (نسخة العرض تعرضها كأن المنشأة على باقة كبار العملاء)
  if (p === "/group") return groupView();
  if (p === "/group/entities" && method === "POST") {
    if (!/^\d{10}$/.test(String(body.cr_number ?? ""))) throw new DemoError(422, "رقم السجل التجاري 10 أرقام");
    const id = uid();
    groupKids.push({ id, name: String(body.name), cr_number: String(body.cr_number), entity_legal_type: String(body.entity_legal_type),
      entity_relation: (body.entity_relation as "SUBSIDIARY") ?? "SUBSIDIARY", commercial_size: (body.commercial_size as string) ?? "SMALL",
      haseef_score: null as unknown as number, items: { expired: 0, expiring: 0, total: 0 }, policies_due: 0,
      obligations: { pending: 12, total: 12 }, open_incidents: 0, structure_score: null as unknown as number });
    return { id };
  }
  if (p === "/reports/board" && method === "GET") {
    const year = Number(q.get("year") ?? riyadhToday().getUTCFullYear());
    const saved = savedReports.get(year) ?? null;
    return { live: boardReport(year), saved, saved_years: [...savedReports.keys()].sort((a, b) => b - a) };
  }
  if ((m = p.match(/^\/reports\/board\/(\d{4})$/)) && method === "PUT") {
    const year = Number(m[1]);
    savedReports.set(year, { snapshot: boardReport(year), notes: (body.notes as string) ?? null, saved_at: new Date().toISOString(), saved_by_name: "أحمد العتيبي" });
    return { saved: true };
  }

  // ---------- التنبيهات
  if (p === "/alerts/overview") return alertsOverview();
  if (p === "/alert-rules" && method === "PUT") {
    const t = String(body.target_type) as "COMPLIANCE_ITEM" | "POLICY";
    const days = (body.days_before as number[]).filter((x) => Number.isInteger(x) && x >= 0);
    if (!days.length) throw new DemoError(422, "حدد موعداً واحداً على الأقل");
    alertRules[t] = { target_type: t, days_before: [...new Set(days)].sort((a, b) => b - a), channels: body.channels as string[],
      is_enabled: Boolean(body.is_enabled), is_default: false };
    return { id: `rule-${t}` };
  }
  if ((m = p.match(/^\/alerts\/recipients\/([^/]+)$/))) {
    const r = recipients.find((x) => x.membership_id === m![1]); if (!r) throw new DemoError(404, "العضو غير موجود");
    const ch = (body.alert_channels as string[]) ?? [];
    if (body.receives_alerts && !ch.length) throw new DemoError(422, "اختر قناة واحدة على الأقل");
    r.receives_alerts = Boolean(body.receives_alerts); r.alert_channels = [...new Set(ch)].sort(); return { updated: true };
  }

  // ---------- حماية البيانات
  if (p === "/pdpl/summary") {
    const open = (r: { status: string }) => r.status === "OPEN" || r.status === "IN_PROGRESS";
    return { records: { n: ropa.length, no_owner: ropa.filter((r) => !r.owner_membership_id).length,
                        cross_border: ropa.filter((r) => r.cross_border_transfer).length,
                        sensitive: ropa.filter((r) => r.includes_sensitive_data).length, review_overdue: 0 },
             requests: { open: dsr.filter(open).length, overdue: dsr.filter((r) => open(r) && daysLeft(r.due_on) < 0).length },
             incidents: { open: incidents.filter((i) => i.status !== "CLOSED").length,
                          notify_overdue: incidents.filter((i) => i.harm_likely && !i.authority_notified_at && i.status !== "CLOSED"
                            && Date.now() > new Date(i.discovered_at).getTime() + 72 * 3600e3).length },
             dpia: { n: dpias.length, approved: dpias.filter((d) => d.status === "APPROVED").length,
                     open: dpias.filter((d) => d.status !== "APPROVED").length,
                     high_residual: dpias.map(dpiaView).filter((d) => d.status !== "APPROVED" && (d.residual_level === "HIGH" || d.residual_level === "CRITICAL")).length },
             notify_hours: 72, request_days: 30 };
  }
  if (p === "/pdpl/owners") return [{ id: OWNER_ID, full_name: "أحمد العتيبي", role: "ORG_ADMIN" }, { id: "own-reem", full_name: "ريم السبيعي", role: "DPO" }];
  if (p === "/pdpl/record-templates") return CONTENT.ropa_templates.map((t) => ({ key: t.key, activity_name: t.activity_name, data_subjects: t.data_subjects }));
  if (p === "/pdpl/records" && method === "GET") return ropa.map(ropaView);
  if ((m = p.match(/^\/pdpl\/records\/from-template\/([^/]+)$/))) {
    const t = CONTENT.ropa_templates.find((x) => x.key === m![1]); if (!t) throw new DemoError(404, "النموذج غير موجود");
    const { key: _k, ...rest } = t;
    const id = uid();
    ropa.push({ cross_border_transfer: false, transfer_destination: null, transfer_safeguard: null, ...clone(rest), id,
                owner_membership_id: OWNER_ID, next_review_date: inDays(365) } as DemoRopa);
    recheck(); return { id };
  }
  if (p === "/pdpl/records" && method === "POST") {
    if (body.cross_border_transfer && !(body.transfer_destination && body.transfer_safeguard)) throw new DemoError(422, "النقل خارج المملكة يتطلب تحديد الوجهة والأساس النظامي");
    const id = uid(); ropa.push({ ...(body as unknown as DemoRopa), id }); recheck(); return { id };
  }
  if ((m = p.match(/^\/pdpl\/records\/([^/]+)$/))) {
    const k = ropa.findIndex((r) => r.id === m![1]); if (k < 0) throw new DemoError(404, "النشاط غير موجود");
    if (method === "DELETE") ropa.splice(k, 1); else Object.assign(ropa[k], body, { id: ropa[k].id });
    recheck(); return method === "DELETE" ? undefined : { updated: true };
  }
  if (p === "/pdpl/requests" && method === "GET") return dsr.map((r) => ({ ...r, days_left: daysLeft(r.due_on) }))
    .sort((a, b) => Number(["COMPLETED", "REJECTED"].includes(a.status)) - Number(["COMPLETED", "REJECTED"].includes(b.status)) || a.due_on.localeCompare(b.due_on));
  if (p === "/pdpl/requests" && method === "POST") {
    const id = uid(); const recv = String(body.received_on);
    const due = (body.due_on as string) || iso(new Date(new Date(`${recv}T00:00:00Z`).getTime() + 30 * DAY));
    dsr.push({ id, requester_name: String(body.requester_name), requester_contact: (body.requester_contact as string) ?? null,
               request_type: String(body.request_type), channel: String(body.channel), details: (body.details as string) ?? null,
               received_on: recv, due_on: due, identity_verified: false, status: "OPEN", response_note: null, completed_on: null });
    return { id, due_on: due };
  }
  if ((m = p.match(/^\/pdpl\/requests\/([^/]+)$/))) {
    const r = dsr.find((x) => x.id === m![1]); if (!r) throw new DemoError(404, "الطلب غير موجود");
    if (body.status === "COMPLETED" && !body.identity_verified) throw new DemoError(422, "تحقق من هوية مقدم الطلب قبل إغلاقه بالتنفيذ");
    const done = body.status === "COMPLETED" || body.status === "REJECTED";
    Object.assign(r, { status: body.status, identity_verified: !!body.identity_verified, response_note: (body.response_note as string) ?? r.response_note,
                       completed_on: done ? r.completed_on ?? inDays(0) : null });
    return { updated: true };
  }
  if (p === "/pdpl/incidents" && method === "GET") return incidents.map((i) => ({ ...i,
    notify_deadline: new Date(new Date(i.discovered_at).getTime() + 72 * 3600e3).toISOString() }))
    .sort((a, b) => Number(a.status === "CLOSED") - Number(b.status === "CLOSED") || b.discovered_at.localeCompare(a.discovered_at));
  if (p === "/pdpl/incidents" && method === "POST") {
    const id = uid();
    incidents.push({ id, title: String(body.title), description: (body.description as string) ?? null, discovered_at: String(body.discovered_at),
      occurred_at: (body.occurred_at as string) ?? null, data_categories: (body.data_categories as string[]) ?? [],
      subjects_affected: (body.subjects_affected as number) ?? null, severity: String(body.severity ?? "MEDIUM"), harm_likely: body.harm_likely !== false,
      status: "OPEN", authority_notified_at: null, subjects_notified_at: null, root_cause: null, actions_taken: null });
    return { id };
  }
  if ((m = p.match(/^\/pdpl\/incidents\/([^/]+)$/))) {
    const i = incidents.find((x) => x.id === m![1]); if (!i) throw new DemoError(404, "الحادثة غير موجودة");
    if (body.status === "REPORTED" && !(body.authority_notified_at || i.authority_notified_at)) throw new DemoError(422, "سجّل وقت إبلاغ الجهة المختصة");
    for (const k of ["harm_likely", "authority_notified_at", "subjects_notified_at", "root_cause", "actions_taken"] as const)
      if (body[k] !== undefined && body[k] !== null) (i as Record<string, unknown>)[k] = body[k];
    i.status = String(body.status);
    return { updated: true };
  }

  if (p === "/obligations") return obligationsView();
  if ((m = p.match(/^\/obligations\/([^/]+)$/))) {
    const o = oblState.get(m[1]); if (!o) throw new DemoError(404, "الالتزام غير موجود");
    Object.assign(o, { status: body.status, note: body.note ?? null, source: "MANUAL" }); return { updated: true };
  }
  if (p === "/library") return library.filter((d) => d.is_visible).map((d) => ({ ...d, adopted: policies.some((x) => x.source === d.id) }));
  if ((m = p.match(/^\/library\/([^/]+)\/file$/))) return fileOf(m[1]);
  if ((m = p.match(/^\/library\/([^/]+)\/adopt$/))) {
    const d = library.find((x) => x.id === m![1] && x.is_visible);
    if (!d || !d.policy_type) throw new DemoError(404, "النموذج غير متاح للتبني");
    const id = uid();
    policies.push({ id, source: d.id, policy_type: d.policy_type, title: d.title.replace(/^نموذج /, ""), version: "1.0",
      approval_date: null, review_due_date: inDays(365), status: "DRAFT",
      body_md: (d.body_md ?? "").replaceAll("«اسم المنشأة»", "مؤسسة النخبة للمقاولات").replaceAll("«اسم الشركة»", "مؤسسة النخبة للمقاولات") });
    return { policy_id: id };
  }
  if ((m = p.match(/^\/library\/([^/]+)$/))) {
    const d = library.find((x) => x.id === m![1] && x.is_visible); if (!d) throw new DemoError(404, "المستند غير موجود"); return d;
  }
  if (p === "/policies" && method === "GET") return policies.map(policyView);
  if ((m = p.match(/^\/policies\/([^/]+)\/approve$/))) {
    const x = policies.find((y) => y.id === m![1]); if (!x) throw new DemoError(404, "السياسة غير موجودة");
    Object.assign(x, { status: "ACTIVE", approval_date: inDays(0), review_due_date: inDays(365) }); recheck(); return { status: "ACTIVE" };
  }
  if ((m = p.match(/^\/policies\/([^/]+)$/))) {
    const x = policies.find((y) => y.id === m![1]); if (!x) throw new DemoError(404, "السياسة غير موجودة");
    if (method === "PATCH") { Object.assign(x, { title: body.title, body_md: body.body_md, version: body.version }); return { updated: true }; }
    return { ...policyView(x), body_md: x.body_md, source_library_id: x.source };
  }

  if (p === "/dashboard") return dashboard();
  if (p === "/compliance-items" && method === "GET") return itemViews();
  if (p === "/compliance-items" && method === "POST") {
    const i: StoredItem = { id: uid(), category: body.category as StoredItem["category"], title: String(body.title), reference_number: (body.reference_number as string) ?? null,
      issue_date: (body.issue_date as string) ?? null, expiry_date: String(body.expiry_date), risk_level: body.risk_level as StoredItem["risk_level"], renewal_url: (body.renewal_url as string) ?? null };
    items.push(i); return view(i);
  }
  if ((m = p.match(/^\/compliance-items\/([^/]+)\/renew$/))) {
    const i = items.find((x) => x.id === m![1]); if (!i) throw new DemoError(404, "الترخيص غير موجود");
    i.expiry_date = String(body.new_expiry_date); return view(i);
  }
  if ((m = p.match(/^\/compliance-items\/([^/]+)\/remind$/))) {
    return { queued: 2, message: "أُرسل التذكير الآن إلى واتساب مدير المنشأة وبريده (نسخة عرض: لم يُرسل فعلياً)" };
  }
  if ((m = p.match(/^\/compliance-items\/([^/]+)$/)) && method === "DELETE") {
    const k = items.findIndex((x) => x.id === m![1]); if (k >= 0) items.splice(k, 1); return undefined;
  }
  throw new DemoError(404, "غير متاح في نسخة العرض");
}

/** بديل fetch في نسخة العرض: يرجع Response كما لو جاء من الخادم. */
export async function demoFetch(url: string, init: RequestInit = {}): Promise<Response> {
  await new Promise((r) => setTimeout(r, 120)); // إحساس بطلب حقيقي
  const path = url.replace(/^.*?\/v1/, "");
  const method = (init.method ?? "GET").toUpperCase();
  const auth = new Headers(init.headers).get("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  let body: Record<string, unknown> = {};
  try { body = init.body ? JSON.parse(String(init.body)) : {}; } catch { /* ليس JSON */ }
  try {
    const out = route(method, path, body, token);
    if (out && typeof out === "object" && "__file" in out) {
      const o = out as { __file: string; mime: string };
      const bin = Uint8Array.from(atob(o.__file), (ch) => ch.charCodeAt(0));
      return new Response(bin, { status: 200, headers: { "Content-Type": o.mime } });
    }
    return out === undefined ? new Response(null, { status: 204 }) : new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    const status = e instanceof DemoError ? e.status : 500;
    return new Response(JSON.stringify({ detail: e instanceof Error ? e.message : "خطأ" }), { status, headers: { "Content-Type": "application/json" } });
  }
}
