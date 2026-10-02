// نسخة العرض: خادم وهمي داخل المتصفح ببيانات تجريبية، تُستخدم في رابط GitHub Pages فقط.
// يُفعّلها التطبيق بتمرير demoFetch إلى createApi عند NEXT_PUBLIC_DEMO=1 وقت البناء. لا شيء هنا يصل لقاعدة بيانات؛ التغييرات تبقى في الصفحة
// وتختفي بإعادة التحميل.

import type { ComplianceItem, Dashboard, Me, ScoreReason } from "./types.ts";
import CONTENT from "./demo-content.json" with { type: "json" };
import { runCheck, type CkStandard } from "./governanceCheck.ts";


/** بيانات الدخول لنسخة العرض فقط. ليست حسابات حقيقية ولا تفتح أي نظام فعلي. */
const DEMO_USERS: Record<string, { password: string; token: string }> = {
  "demo@haseef.sa": { password: "Haseef@2026", token: "demo-client" },
  "admin@haseef.sa": { password: "Haseef@2026", token: "demo-admin" },
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
  const reasons: ScoreReason[] = [
    { pillar: "GOVERNANCE_PDPL", severity: "medium", text: "فات موعد مراجعة سياسة الخصوصية", points: 25, points_label: "25 نقطة" },
  ];
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
  const score = Math.round((operational + 50) / 2);
  return {
    org_name: "مؤسسة النخبة للمقاولات", cr_number: "1010123456", greeting_name: "أحمد العتيبي",
    plan_tier: "PROFESSIONAL_GRC", automation_active: true,
    score: {
      score, pillars: { OPERATIONAL: operational, GOVERNANCE_PDPL: 50, CONTRACTS: null },
      weights_used: { OPERATIONAL: 50, GOVERNANCE_PDPL: 50 }, capped_by_critical_expiry: false,
      reasons: reasons.sort((a, b) => b.points - a.points), computed_at: ago(5),
    },
    action_required: all.filter((i) => i.action_required),
    counts: {
      active: all.filter((i) => i.status === "ACTIVE").length,
      expiring_soon: all.filter((i) => i.status === "EXPIRING_SOON").length,
      expired: all.filter((i) => i.status === "EXPIRED").length,
      policies_due: 1,
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
const PRICES: Record<string, [number, number]> = { ESSENTIAL: [149, 1490], PROFESSIONAL_GRC: [499, 4990], ENTERPRISE: [1490, 14900] };
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
    billing: [{ event_type: "PAYMENT", plan_tier: "ESSENTIAL", amount_sar: 1490, period_months: 12, reference: "INV-2026-0003", note: null, created_at: ts(-60), actor: "المحاسبة" }],
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
  { id: uid(), full_name: "الدعم الفني", email: "support@haseef.sa", platform_role: "SUPPORT", is_active: true, last_login_at: ago(60 * 3), must_change_password: false },
  { id: uid(), full_name: "المحاسبة", email: "billing@haseef.sa", platform_role: "BILLING", is_active: true, last_login_at: ago(60 * 30), must_change_password: false },
];
let auditSeq = 50;
const audit: { id: number; created_at: string; action: string; entity_type: string; entity_id: string | null; changes: Record<string, unknown> | null; ip: string | null; actor: string | null; actor_role: string | null; org_name: string | null; org_id: string | null }[] = [
  { id: 3, created_at: ts(-3), action: "ADMIN_CREATE_ORG", entity_type: "organization", entity_id: ORG_C, changes: { name: "شركة الأفق للتجارة", cr_number: "4030111222", plan: "PROFESSIONAL_GRC" }, ip: "10.0.0.4", actor: "الدعم الفني", actor_role: "SUPPORT", org_name: "شركة الأفق للتجارة", org_id: ORG_C },
  { id: 2, created_at: ts(-10), action: "ADMIN_RECORD_PAYMENT", entity_type: "subscription", entity_id: null, changes: { amount_sar: 499, cycle: "MONTHLY", reference: "INV-2026-0007" }, ip: "10.0.0.4", actor: "فريق عمليات حصيف", actor_role: "SUPER_ADMIN", org_name: "مؤسسة النخبة للمقاولات", org_id: ORG_A },
  { id: 1, created_at: ts(-60), action: "ADMIN_RECORD_PAYMENT", entity_type: "subscription", entity_id: null, changes: { amount_sar: 1490, cycle: "YEARLY", reference: "INV-2026-0003" }, ip: "10.0.0.7", actor: "المحاسبة", actor_role: "BILLING", org_name: "شركة واحة التقنية", org_id: ORG_B },
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

// ---------- الموجّه ----------
class DemoError extends Error {
  status: number;
  constructor(status: number, msg: string) { super(msg); this.status = status; }
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
  if (!token) throw new DemoError(401, "سجّل الدخول أولاً");
  const isAdmin = token === "demo-admin";
  if (p === "/auth/me") return isAdmin ? ADMIN_ME : CLIENT_ME;
  if (p === "/auth/change-password") return undefined;

  if (p.startsWith("/admin")) {
    if (!isAdmin) throw new DemoError(403, "هذه الواجهة لفريق حصيف فقط");
    if (p === "/admin/me") return { user_id: ADMIN_ME.id, role: "SUPER_ADMIN" };
    if (p === "/admin/overview") return overview();
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
      if (method === "GET") return orgDetail(o);
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
    if (p === "/admin/audit") { const id = q.get("org_id"); return id ? audit.filter((a) => a.org_id === id) : audit; }
    if (p === "/admin/dispatches") return dispatches();
    if (p === "/admin/ai-usage") return orgs.map((o) => ({ org_id: o.id, name: o.name, plan_tier: o.sub?.plan_tier ?? null,
      quota: o.sub?.plan_tier === "ESSENTIAL" ? 3 : 15, audits_this_month: o.id === ORG_A ? 4 : 0, tokens: o.id === ORG_A ? 48_200 : 0, cost_sar: o.id === ORG_A ? 3.6 : 0 }));
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
