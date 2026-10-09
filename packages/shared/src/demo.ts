// نسخة العرض: خادم وهمي داخل المتصفح ببيانات تجريبية، تُستخدم في رابط GitHub Pages فقط.
// يُفعّلها التطبيق بتمرير demoFetch إلى createApi عند NEXT_PUBLIC_DEMO=1 وقت البناء. لا شيء هنا يصل لقاعدة بيانات؛ التغييرات تبقى في الصفحة
// وتختفي بإعادة التحميل.

import type { ComplianceItem, Dashboard, Me, ScoreReason } from "./types.ts";
import CONTENT from "./demo-content.json" with { type: "json" };
import { runCheck, type CkStandard } from "./governanceCheck.ts";
import { dpiaAssess, dpiaSuggest } from "./dpia.ts";
import type { PromoStatus } from "./api.ts";
import type { AnnualEvent, DeductionSuggestion, LeaveRow, AttendanceSettings, DpiaMitigation, DpiaQuestion, Employee, LaborProfile, SiteInput, TaxProfile } from "./api.ts";
import {
  EMP_DOC_LABEL, GOSI_RATES, TASK_KINDS, TASK_LABEL, contribution, gosiLatePenalty, monthStart, periodsToPlan, pickRate,
  qiwaIndicators, rateSystem, taskDueDate, type GosiSystem, type LaborTaskKind, type Nationality,
} from "./labor.ts";
import { TAX_LABEL, addDaysIso, taxPeriodLabel, taxPlan, type TaxKind } from "./tax.ts";
import { buildIcs } from "./ics.ts";
import { botHandle, type BotState } from "./bot.ts";
import { ATT_FLAG, ATT_REASON, evaluateAttendance, type AttResult } from "./attendance.ts";
import { resolvePaid, type PayMode } from "./hr.ts";
import { DEFAULT_POLICIES, FINE_KINDS, KIND_LABEL, LEAVE_LABEL, LEAVE_TYPES, addDays as isoAddDays, annualEntitlement, countLeaveDays, dailyWage, diffDays, fmtDays, holidayDates,
  lateAmount, lateReturnDays, sickNote, validateDeduction, validateLeave, weekday0, type DeductionKind, type LeavePolicy, type LeaveType } from "./hr.ts";
import { EXPENSE_CATEGORY, VAT_RATE, invoiceLine, invoiceNumber, periodRange, round2, zatcaTlv, type InvoiceLine } from "./finance.ts";


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
const PRICES: Record<string, [number, number]> = { ESSENTIAL: [219, 2190], PROFESSIONAL_GRC: [549, 5490], ENTERPRISE: [1429, 14290] };
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
    id: ORG_A, name: "مؤسسة النخبة للمقاولات", cr: "1010123456", legal: "LLC", industry: "المقاولات", size: "SMALL",
    score: 66, suspended_at: null, reason: null, created_at: ts(-40),
    sub: { id: uid(), plan_tier: "PROFESSIONAL_GRC", billing_cycle: "YEARLY", billing_status: "ACTIVE", starts_at: ts(-10), ends_at: ts(355) },
    members: [
      { membership_id: uid(), role: "ORG_ADMIN", user_id: CLIENT_ME.id, full_name: "أحمد العتيبي", email: "demo@haseef.sa", phone: "+966500000001", active: true, last: ago(30) },
      { membership_id: uid(), role: "EXTERNAL_ADVISOR", user_id: uid(), full_name: "مكتب المستشار القانوني", email: "advisor@example.sa", phone: null, active: true, last: ago(60 * 26) },
    ],
    billing: [
      { event_type: "PAYMENT", plan_tier: "PROFESSIONAL_GRC", amount_sar: 1247.5, period_months: 3, reference: "INV-2026-0007", note: "القسط 1 من 4", created_at: ts(-10), actor: "فريق عمليات حصيف" },
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
    billing: [
      { event_type: "PAYMENT", plan_tier: "ESSENTIAL", amount_sar: 1990, period_months: 12, reference: "INV-2026-0003", note: "تحويل للاشتراك السنوي", created_at: ts(-60), actor: "المحاسبة" },
      { event_type: "PAYMENT", plan_tier: "ESSENTIAL", amount_sar: 199, period_months: 1, reference: "INV-2026-0001", note: null, created_at: ts(-75), actor: "المحاسبة" },
    ],
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
let actor = { name: "فريق عمليات حصيف", role: "SUPER_ADMIN" };   // عضو الفريق الحالي في نسخة العرض
const audit: { id: number; created_at: string; action: string; entity_type: string; entity_id: string | null; changes: Record<string, unknown> | null; ip: string | null; actor: string | null; actor_role: string | null; org_name: string | null; org_id: string | null }[] = [
  { id: 3, created_at: ts(-3), action: "ADMIN_CREATE_ORG", entity_type: "organization", entity_id: ORG_C, changes: { name: "شركة الأفق للتجارة", cr_number: "4030111222", plan: "PROFESSIONAL_GRC" }, ip: "10.0.0.4", actor: "الدعم الفني", actor_role: "SUPPORT", org_name: "شركة الأفق للتجارة", org_id: ORG_C },
  { id: 2, created_at: ts(-10), action: "ADMIN_RECORD_PAYMENT", entity_type: "subscription", entity_id: null, changes: { amount_sar: 1247.5, cycle: "YEARLY", reference: "INV-2026-0007" }, ip: "10.0.0.4", actor: "فريق عمليات حصيف", actor_role: "SUPER_ADMIN", org_name: "مؤسسة النخبة للمقاولات", org_id: ORG_A },
  { id: 1, created_at: ts(-60), action: "ADMIN_RECORD_PAYMENT", entity_type: "subscription", entity_id: null, changes: { amount_sar: 1990, cycle: "YEARLY", reference: "INV-2026-0003" }, ip: "10.0.0.7", actor: "المحاسبة", actor_role: "BILLING", org_name: "شركة واحة التقنية", org_id: ORG_B },
];
function log(action: string, org: Org | null, changes: Record<string, unknown> | null) {
  audit.unshift({ id: ++auditSeq, created_at: new Date().toISOString(), action, entity_type: org ? "organization" : "user", entity_id: org?.id ?? null,
    changes, ip: "—", actor: actor.name, actor_role: actor.role, org_name: org?.name ?? null, org_id: org?.id ?? null });
}

// منشأة العرض الرئيسية: مؤشرها وأعدادها تُحسب من بيانات العميل نفسها حتى تتطابق الواجهتان
const liveScore = (o: Org) => (o.id === ORG_A ? dashboard().score.score : o.score);
const liveCounts = (o: Org) => (o.id === ORG_A
  ? { items: items.length, expired: itemViews().filter((i) => i.status === "EXPIRED").length, policies: policies.length } : o.counts);
const orgRow = (o: Org) => ({
  id: o.id, name: o.name, cr_number: o.cr, industry_type: o.industry, haseef_score: liveScore(o), created_at: o.created_at,
  suspended_at: o.suspended_at, plan_tier: o.sub?.plan_tier ?? null, billing_status: o.sub?.billing_status ?? null,
  ends_at: o.sub?.ends_at ?? null, members: o.members.length,
});
const orgDetail = (o: Org) => ({
  organization: { id: o.id, name: o.name, cr_number: o.cr, entity_legal_type: o.legal, industry_type: o.industry, commercial_size: o.size,
    haseef_score: liveScore(o), is_active: true, suspended_at: o.suspended_at, suspension_reason: o.reason, created_at: o.created_at },
  subscription: o.sub && { ...o.sub, monthly_price_sar: PRICES[o.sub.plan_tier][0], yearly_price_sar: PRICES[o.sub.plan_tier][1] },
  members: o.members.map((m) => ({ membership_id: m.membership_id, role: m.role, membership_active: m.active, receives_alerts: true,
    user_id: m.user_id, full_name: m.full_name, email: m.email, phone_number: m.phone, user_active: m.active,
    last_login_at: m.last, must_change_password: false, is_team_member: false })),
  billing: o.billing, counts: liveCounts(o),
});
function overview() {
  const live = orgs.filter((o) => o.sub && !o.suspended_at && o.sub.billing_status !== "CANCELED");
  const mrr = live.filter((o) => o.sub!.billing_status === "ACTIVE")
    .reduce((s, o) => s + (o.sub!.billing_cycle === "YEARLY" ? PRICES[o.sub!.plan_tier][1] / 12 : PRICES[o.sub!.plan_tier][0]), 0);
  const scored = orgs.filter((o) => o.score !== null);
  const count = (f: (o: Org) => string) => Object.entries(live.reduce<Record<string, number>>((a, o) => ({ ...a, [f(o)]: (a[f(o)] ?? 0) + 1 }), {}));
  return {
    kpis: { active_orgs: live.length, trials: live.filter((o) => o.sub!.billing_status === "TRIAL").length, mrr_sar: mrr,
      avg_score: scored.length ? Math.round(scored.reduce((s, o) => s + liveScore(o)!, 0) / scored.length) : null },
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

// ---------- أدوار فريق حصيف وصلاحياتها في نسخة العرض (تطابق apps/api/haseef/permissions.py) ----------
const ADMIN_PERMISSIONS: { code: string; name: string; group: string; description: string }[] = [
  { code: "overview.view", name: "النظرة العامة", group: "عام", description: "لوحة الأرقام الرئيسية وتوزيع الباقات والقطاعات" },
  { code: "finance.view", name: "رؤية الأرقام المالية", group: "المالية", description: "الإيراد الشهري، مبالغ الدفعات ومراجعها، تكلفة الذكاء الاصطناعي" },
  { code: "billing.manage", name: "إدارة الاشتراكات والدفعات", group: "المالية", description: "تسجيل الدفعات، تغيير الباقة، تمديد التجربة، إلغاء الاشتراك" },
  { code: "expenses.manage", name: "المصروفات وبيانات الفوترة", group: "المالية", description: "تسجيل المصروفات، إلغاء الفواتير بإشعار دائن، وبيانات حصيف الضريبية" },
  { code: "orgs.view", name: "عرض بيانات المنشآت", group: "المنشآت", description: "تفاصيل المنشأة وأعضاؤها ومؤشرها وحوكمتها" },
  { code: "orgs.manage", name: "إدارة المنشآت ومستخدميها", group: "المنشآت", description: "إنشاء المنشآت وتعديلها، دعوة المستخدمين، إعادة كلمات المرور والتعطيل" },
  { code: "orgs.suspend", name: "تعليق المنشآت", group: "المنشآت", description: "تعليق حساب منشأة وإعادة تفعيله" },
  { code: "trials.manage", name: "طلبات التجربة", group: "المبيعات", description: "عرض طلبات التجربة ومتابعتها" },
  { code: "alerts.view", name: "مراقب التنبيهات", group: "التشغيل", description: "سجل إرسال التنبيهات وحالتها" },
  { code: "legal.cases", name: "الاستشارات: المواعيد والإغلاق", group: "الاستشارات", description: "تعيين المحامي والموعد، الإكمال، الإلغاء، رؤية تفاصيل القضية" },
  { code: "legal.billing", name: "الاستشارات: الدفع والتسعيرة", group: "الاستشارات", description: "تسجيل دفع الاستشارات واستردادها وتعديل الأسعار" },
  { code: "legal.lawyers", name: "إدارة المحامين", group: "الاستشارات", description: "إضافة المحامين وتعديل بياناتهم وتراخيصهم" },
  { code: "content.manage", name: "إدارة المحتوى المرجعي", group: "المحتوى", description: "المكتبة والمعايير والالتزامات: إضافة وتعديل وإخفاء" },
  { code: "content.approve", name: "اعتماد المحتوى", group: "المحتوى", description: "اعتماد المحتوى أو إعادته لمسودة، وحذف المستندات" },
  { code: "usage.view", name: "استهلاك الذكاء الاصطناعي", group: "التشغيل", description: "الاستهلاك مقابل حصة كل باقة" },
  { code: "audit.view", name: "سجل التدقيق", group: "الرقابة", description: "سجل الإجراءات (يُقيَّد بحسب صلاحيات المنشآت والمالية)" },
  { code: "team.view", name: "عرض الفريق", group: "الفريق", description: "قائمة أعضاء فريق حصيف وأدوارهم" },
  { code: "team.manage", name: "إدارة الفريق والأدوار", group: "الفريق", description: "إضافة الأعضاء، تغيير أدوارهم، إنشاء الأدوار وتعديل صلاحياتها" },
];
const PERM_ALL = ADMIN_PERMISSIONS.map((x) => x.code);
const PERM_LABEL = Object.fromEntries(ADMIN_PERMISSIONS.map((x) => [x.code, x.name]));
type DemoRole = { code: string; name: string; description: string | null; permissions: string[]; is_system: boolean; created_at: string; updated_at: string };
const adminRoles: DemoRole[] = [
  { code: "SUPER_ADMIN", name: "المدير العام", description: "كل الصلاحيات، ولا تُعدَّل", permissions: [], is_system: true, created_at: ts(-200), updated_at: ts(-200) },
  { code: "SUPPORT", name: "الدعم الفني", description: "إنشاء المنشآت وتعديلها وإدارة مستخدميها، والمحتوى، والاستشارات، دون الأرقام المالية",
    permissions: ["overview.view", "orgs.view", "orgs.manage", "trials.manage", "alerts.view", "legal.cases", "content.manage", "usage.view", "team.view", "audit.view"],
    is_system: true, created_at: ts(-200), updated_at: ts(-200) },
  { code: "BILLING", name: "المحاسبة", description: "الاشتراكات والدفعات والباقات وتسعير الاستشارات، دون بيانات العملاء التشغيلية",
    permissions: ["overview.view", "finance.view", "billing.manage", "expenses.manage", "legal.billing", "usage.view", "audit.view"], is_system: true, created_at: ts(-200), updated_at: ts(-200) },
];
const TEAM_ROLE: Record<string, string> = { "demo-admin": "SUPER_ADMIN", "demo-support": "SUPPORT", "demo-billing": "BILLING" };
const TEAM_ME: Record<string, { id: string; email: string; full_name: string }> = {
  SUPER_ADMIN: { id: "0a1f5c1e-0000-4000-8000-0000000000b1", email: "admin@haseef.sa", full_name: "فريق عمليات حصيف" },
  SUPPORT: { id: "0a1f5c1e-0000-4000-8000-0000000000b2", email: "support@haseef.sa", full_name: "الدعم الفني" },
  BILLING: { id: "0a1f5c1e-0000-4000-8000-0000000000b3", email: "billing@haseef.sa", full_name: "المحاسبة" },
};
function permsOf(role: string): string[] {
  if (role === "SUPER_ADMIN") return PERM_ALL;
  return adminRoles.find((r) => r.code === role)?.permissions ?? [];
}
function canDo(role: string, ...perms: string[]): boolean {
  if (role === "SUPER_ADMIN") return true;
  const mine = permsOf(role);
  return perms.some((x) => mine.includes(x));
}
// [طريقة، مسار، الصلاحيات المقبولة] — أول تطابق يُعتمد. قائمة فارغة = المدير العام فقط.
const PERM_RULES: [RegExp, RegExp, string[]][] = [
  [/GET/, /^\/admin\/overview$/, ["overview.view"]],
  [/GET/, /^\/admin\/organizations$/, ["orgs.view", "billing.manage", "finance.view"]],
  [/POST/, /^\/admin\/organizations$/, ["orgs.manage"]],
  [/GET/, /^\/admin\/organizations\/[^/]+\/governance$/, ["orgs.view"]],
  [/GET/, /^\/admin\/organizations\/[^/]+$/, ["orgs.view", "billing.manage", "finance.view"]],
  [/POST/, /\/(suspend|reactivate)$/, ["orgs.suspend"]],
  [/POST/, /\/subscription\/extend-trial$/, ["billing.manage", "orgs.manage"]],
  [/POST/, /\/subscription\//, ["billing.manage"]],
  [/./, /^\/admin\/(organizations|memberships|users)\//, ["orgs.manage"]],
  [/GET/, /^\/admin\/dispatches/, ["alerts.view"]],
  [/GET/, /^\/admin\/ai-usage/, ["usage.view"]],
  [/./, /^\/admin\/trial-requests/, ["trials.manage"]],
  [/DELETE/, /^\/admin\/library/, ["content.approve"]],
  [/POST/, /^\/admin\/(library|catalog)/, ["content.manage"]],
  [/./, /^\/admin\/(library|catalog)/, ["content.manage", "content.approve"]],
  [/GET/, /^\/admin\/legal\/(consultations|rates)/, ["legal.cases", "legal.billing"]],
  [/./, /^\/admin\/legal\/consultations\/[^/]+\/payment$/, ["legal.billing"]],
  [/./, /^\/admin\/legal\/consultations/, ["legal.cases"]],
  [/./, /^\/admin\/legal\/rates/, ["legal.billing"]],
  [/GET/, /^\/admin\/legal\/lawyers/, ["legal.cases", "legal.lawyers"]],
  [/./, /^\/admin\/legal\/lawyers/, ["legal.lawyers"]],
  [/GET/, /^\/admin\/(team|roles)$/, ["team.view", "team.manage"]],
  [/./, /^\/admin\/(team|roles)/, ["team.manage"]],
  [/GET/, /^\/admin\/audit/, ["audit.view"]],
  [/PUT/, /^\/admin\/gosi-rates/, ["content.manage"]],
  [/./, /^\/admin\/events/, ["content.manage"]],
  [/GET/, /^\/admin\/pricing/, ["finance.view", "billing.manage"]],
  [/./, /^\/admin\/pricing/, ["billing.manage"]],
  [/GET/, /^\/admin\/gosi-rates/, ["content.manage", "content.approve", "finance.view", "expenses.manage"]],
  [/GET/, /^\/admin\/finance\/plans/, ["finance.view", "billing.manage"]],
  [/./, /^\/admin\/finance\/plans/, ["billing.manage"]],
  [/GET/, /^\/admin\/finance\/invoices/, ["finance.view", "billing.manage"]],
  [/GET/, /^\/admin\/finance\/profile/, ["finance.view", "expenses.manage", "billing.manage"]],
  [/GET/, /^\/admin\/finance\/expenses/, ["finance.view", "expenses.manage"]],
  [/GET/, /^\/admin\/finance/, ["finance.view"]],
  [/./, /^\/admin\/finance/, ["expenses.manage"]],
];
function requirePerm(role: string, method: string, p: string, body: Record<string, unknown>) {
  if (role === "SUPER_ADMIN") return;
  const rule = PERM_RULES.find(([mm, pp]) => mm.test(method) && pp.test(p));
  const need = rule ? rule[2] : [];
  if (!need.length) throw new DemoError(403, "هذا الإجراء متاح للمدير العام فقط");
  if (!canDo(role, ...need)) throw new DemoError(403, `هذا الإجراء يتطلب صلاحية: ${need.map((x) => PERM_LABEL[x]).join("، ")}`);
  if ("review_status" in body && !canDo(role, "content.approve")) throw new DemoError(403, "اعتماد المحتوى يتطلب صلاحية: اعتماد المحتوى");
}
function guardGrant(role: string, target: { code: string; permissions: string[] }) {
  if (role === "SUPER_ADMIN") return;
  if (target.code === "SUPER_ADMIN") throw new DemoError(403, "دور المدير العام يمنحه مدير عام فقط");
  const extra = target.permissions.filter((x) => !permsOf(role).includes(x));
  if (extra.length) throw new DemoError(403, `لا يمكنك منح صلاحيات لا تملكها: ${extra.map((x) => PERM_LABEL[x]).join("، ")}`);
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


// ---------- المالية الداخلية لحصيف (نسخة العرض) — مطابقة لـ apps/api/haseef/routers/finance.py ----------
type DemoInvoice = {
  id: string; number: string; kind: "INVOICE" | "CREDIT_NOTE"; source: "SUBSCRIPTION" | "CONSULTATION" | "MANUAL";
  org_id: string | null; consultation_id: string | null; related_invoice_id: string | null; buyer_name: string; buyer_cr: string | null;
  buyer_vat: string | null; seller: Record<string, unknown>; lines: InvoiceLine[]; subtotal: number; vat_rate: number; vat_amount: number;
  total: number; payment_reference: string | null; note: string | null; qr: string | null; issued_at: string; status: "ISSUED" | "VOID";
  void_reason: string | null; plan_cycle: "MONTHLY" | "YEARLY" | null;
};
type DemoExpense = { id: string; spent_on: string; category: string; vendor: string; description: string | null; net_amount: number;
  vat_amount: number; total: number; reference: string | null; frequency: "ONE_TIME" | "MONTHLY" | "YEARLY"; created_at: string; created_by_name: string | null };

const finProfile = {
  legal_name: "شركة حصيف لتقنية المعلومات (نموذج)", trade_name: "حصيف", vat_registered: true, vat_number: "300000000000003",
  cr_number: "1010000000", address: "الرياض، المملكة العربية السعودية", email: "billing@haseef.sa", phone: null as string | null,
  iban: null as string | null, invoice_note: "شكراً لثقتكم. هذه فاتورة نموذجية في نسخة العرض." as string | null,
};
const invoicesDemo: DemoInvoice[] = [];
const invSeq = { INVOICE: 0, CREDIT_NOTE: 0 };
const PLAN_AR: Record<string, string> = { ESSENTIAL: "باقة الأساس", PROFESSIONAL_GRC: "باقة الحوكمة والنمو", ENTERPRISE: "باقة كبار العملاء" };

function issueInvoice(x: { kind?: "INVOICE" | "CREDIT_NOTE"; source: DemoInvoice["source"]; org: Org | null; lines: InvoiceLine[];
  at?: string; ref?: string | null; consultation_id?: string | null; related?: DemoInvoice; note?: string | null; cycle?: "MONTHLY" | "YEARLY" | null }): DemoInvoice {
  const kind = x.kind ?? "INVOICE";
  const reg = finProfile.vat_registered;
  const lines = x.related ? x.related.lines.map((l) => ({ ...l, description: `إلغاء: ${l.description}` }))
    : reg ? x.lines : x.lines.map((l) => ({ ...l, vat: 0, total: l.net }));
  const subtotal = x.related ? x.related.subtotal : round2(lines.reduce((a, l) => a + l.net, 0));
  const vat = x.related ? x.related.vat_amount : round2(lines.reduce((a, l) => a + l.vat, 0));
  const issued = (x.at ?? new Date().toISOString()).slice(0, 19) + "Z";
  invSeq[kind] += 1;
  const inv: DemoInvoice = {
    id: uid(), number: invoiceNumber(kind, Number(issued.slice(0, 4)), invSeq[kind]), kind, source: x.source, org_id: x.org?.id ?? x.related?.org_id ?? null,
    consultation_id: x.consultation_id ?? null, related_invoice_id: x.related?.id ?? null,
    buyer_name: x.org?.name ?? x.related?.buyer_name ?? "—", buyer_cr: x.org?.cr ?? x.related?.buyer_cr ?? null, buyer_vat: null,
    seller: { ...finProfile }, lines, subtotal, vat_rate: x.related ? x.related.vat_rate : reg ? VAT_RATE : 0, vat_amount: vat, total: round2(subtotal + vat),
    payment_reference: x.ref ?? null, note: x.note ?? null,
    qr: reg && finProfile.vat_number ? zatcaTlv({ seller: finProfile.legal_name, vatNumber: finProfile.vat_number, timestamp: issued, total: round2(subtotal + vat), vat }) : null,
    issued_at: issued, status: "ISSUED", void_reason: null, plan_cycle: x.related ? x.related.plan_cycle : x.cycle ?? null,
  };
  invoicesDemo.unshift(inv);
  return inv;
}
function subscriptionInvoice(o: Org, plan: string, amount: number, months: number, ref: string | null, at?: string, note?: string | null) {
  const desc = note?.startsWith("القسط") ? `اشتراك سنوي ${PLAN_AR[plan] ?? plan} — ${note}` : `اشتراك ${PLAN_AR[plan] ?? plan} — ${months === 12 ? "سنة" : "شهر"}`;
  return issueInvoice({ source: "SUBSCRIPTION", org: o, ref, at, lines: [invoiceLine(desc, 1, amount)],
    cycle: months === 1 && !note?.startsWith("القسط") ? "MONTHLY" : "YEARLY" });
}
function consultationInvoice(c: { id: string; topic: string; duration_minutes: number; urgent: boolean; price: { subtotal: number } }, ref: string, at?: string) {
  if (invoicesDemo.some((i) => i.consultation_id === c.id && i.kind === "INVOICE")) return null;
  const topic = LEGAL_RATES.find((r) => r.topic === c.topic)?.title ?? c.topic;
  return issueInvoice({ source: "CONSULTATION", org: orgs.find((o) => o.id === ORG_A) ?? null, ref, consultation_id: c.id, at,
    lines: [invoiceLine(`استشارة قانونية — ${topic} (${c.duration_minutes / 60} ساعة${c.urgent ? "، عاجلة" : ""})`, 1, c.price.subtotal)] });
}
function voidInvoice(inv: DemoInvoice, reason: string) {
  if (inv.kind !== "INVOICE") throw new DemoError(404, "الفاتورة غير موجودة");
  if (inv.status === "VOID") throw new DemoError(409, "الفاتورة ملغاة أصلاً");
  const cn = issueInvoice({ kind: "CREDIT_NOTE", source: inv.source, org: null, related: inv, lines: [], note: `إشعار دائن للفاتورة ${inv.number}: ${reason}` });
  Object.assign(inv, { status: "VOID", void_reason: reason });
  return cn;
}

// فواتير الدفعات المسجلة في بيانات العرض (بالترتيب الزمني حتى تتسلسل الأرقام)
(() => {
  const past: { o: Org; plan: string; amount: number; months: number; ref: string | null; at: string; note: string | null }[] = [];
  for (const o of orgs) for (const b of o.billing) if (b.event_type === "PAYMENT" && b.amount_sar)
    past.push({ o, plan: b.plan_tier ?? "ESSENTIAL", amount: b.amount_sar, months: b.period_months ?? 1, ref: b.reference, at: b.created_at, note: b.note });
  past.sort((a, b) => a.at.localeCompare(b.at)).forEach((p) => subscriptionInvoice(p.o, p.plan, p.amount, p.months, p.ref, p.at, p.note));
  for (const c of consults) if (c.payment_status === "PAID") consultationInvoice(c, c.payment_reference ?? "—", c.created_at);
})();

const expensesDemo: DemoExpense[] = (() => {
  const out: DemoExpense[] = [];
  const add = (daysAgo: number, category: string, vendor: string, net: number, vat: number, description: string | null,
    frequency: DemoExpense["frequency"] = "ONE_TIME", reference: string | null = null) =>
    out.push({ id: uid(), spent_on: ts(-daysAgo).slice(0, 10), category, vendor, description, net_amount: net, vat_amount: vat, total: round2(net + vat),
      reference, frequency, created_at: ts(-daysAgo), created_by_name: "المحاسبة" });
  for (const k of [0, 1, 2]) {
    const d = 30 * k + 3;
    add(d, "HOSTING", "مزوّد سحابي داخل المملكة", 300, 45, "خادم 2 نواة / 8 جيجا + تخزين 50 جيجا", "MONTHLY");
    add(d, "MESSAGING", "مزوّد واتساب للأعمال", 12.5, 1.88, "رسائل التنبيهات الخدمية", "MONTHLY");
    add(d + 1, "SOFTWARE", "البريد المهني والأدوات", 90, 13.5, "بريد الفريق وأدوات العمل", "MONTHLY");
    add(d + 2, "PROFESSIONAL", "مكتب محاسبة خارجي", 600, 90, "مسك الدفاتر والإقرار", "MONTHLY");
    add(30 * k + 10, "GOSI", "المؤسسة العامة للتأمينات الاجتماعية", 2350, 0, "اشتراكات موظف سعودي (حصة المنشأة والموظف)", "MONTHLY", `SADAD-${k + 1}`);
  }
  add(20, "MARKETING", "حملة إعلانات رقمية", 1500, 225, "إعلانات البحث لصفحة حصيف التعريفية");
  add(45, "GOVERNMENT", "وزارة التجارة والغرفة التجارية", 1200, 0, "تجديد السجل والاشتراك", "YEARLY");
  add(50, "SOFTWARE", "نطاق haseef.sa والشهادات", 360, 54, "تجديد سنوي", "YEARLY");
  add(8, "PAYMENT_FEES", "بوابة الدفع", 21.4, 3.21, "2.2% من التحصيل");
  add(60, "QIWA", "منصة قوى", 100, 0, "توثيق عقد العمل وخدمات المنشأة", "YEARLY");
  return out.sort((a, b) => b.spent_on.localeCompare(a.spent_on));
})();

function finSummary(period: string) {
  const { from, to } = periodRange(period);
  const inRange = (d: string) => d.slice(0, 10) >= from && d.slice(0, 10) < to;
  const inv = invoicesDemo.filter((i) => inRange(i.issued_at));
  const sign = (i: DemoInvoice) => (i.kind === "INVOICE" ? 1 : -1);
  const bySource = ["CONSULTATION", "MANUAL", "SUBSCRIPTION"].map((source) => {
    const xs = inv.filter((i) => i.source === source);
    return { source, net: round2(xs.reduce((a, i) => a + sign(i) * i.subtotal, 0)), vat: round2(xs.reduce((a, i) => a + sign(i) * i.vat_amount, 0)),
      invoices: xs.filter((i) => i.kind === "INVOICE").length, credit_notes: xs.filter((i) => i.kind === "CREDIT_NOTE").length };
  }).filter((r) => r.invoices + r.credit_notes > 0);
  const ex = expensesDemo.filter((e) => inRange(e.spent_on));
  const byCat = Object.keys(EXPENSE_CATEGORY).map((category) => {
    const xs = ex.filter((e) => e.category === category);
    return { category, net: round2(xs.reduce((a, e) => a + e.net_amount, 0)), vat: round2(xs.reduce((a, e) => a + e.vat_amount, 0)), n: xs.length };
  }).filter((r) => r.n > 0).sort((a, b) => b.net - a.net);
  const months = new Map<string, { month: string; revenue: number; expenses: number }>();
  const mo = (d: string) => `${d.slice(0, 7)}-01`;
  for (const i of inv) { const k = mo(i.issued_at); const r = months.get(k) ?? { month: k, revenue: 0, expenses: 0 }; r.revenue = round2(r.revenue + sign(i) * i.subtotal); months.set(k, r); }
  for (const e of ex) { const k = mo(e.spent_on); const r = months.get(k) ?? { month: k, revenue: 0, expenses: 0 }; r.expenses = round2(r.expenses + e.net_amount); months.set(k, r); }
  const revenue = round2(bySource.reduce((a, r) => a + r.net, 0)), expenses = round2(byCat.reduce((a, r) => a + r.net, 0));
  const out = round2(bySource.reduce((a, r) => a + r.vat, 0)), inp = round2(byCat.reduce((a, r) => a + r.vat, 0));
  const soon = Date.now() + 30 * DAY;
  const due = orgs.filter((o) => o.sub && ["ACTIVE", "PAST_DUE", "TRIAL"].includes(o.sub.billing_status) && new Date(o.sub.ends_at).getTime() < soon)
    .map((o) => ({ org_id: o.id, name: o.name, plan_tier: o.sub!.plan_tier, billing_cycle: o.sub!.billing_cycle, ends_at: o.sub!.ends_at,
      expected: PRICES[o.sub!.plan_tier][o.sub!.billing_cycle === "YEARLY" ? 1 : 0] }))
    .sort((a, b) => a.ends_at.localeCompare(b.ends_at));
  const cyc = (i: DemoInvoice) => (i.source === "SUBSCRIPTION" ? i.plan_cycle ?? "YEARLY" : i.source);
  const byCycle = ["CONSULTATION", "MANUAL", "MONTHLY", "YEARLY"].map((cycle) => {
    const xs = inv.filter((i) => cyc(i) === cycle);
    return { cycle, net: round2(xs.reduce((a, i) => a + sign(i) * i.subtotal, 0)), invoices: xs.filter((i) => i.kind === "INVOICE").length };
  }).filter((r) => r.invoices > 0 || r.net !== 0);
  const active = orgs.filter((o) => o.sub?.billing_status === "ACTIVE");
  const mrrSplit = (["MONTHLY", "YEARLY"] as const).map((cycle) => {
    const xs = active.filter((o) => o.sub!.billing_cycle === cycle);
    return { cycle, subscribers: xs.length, mrr: round2(xs.reduce((a, o) => a + (cycle === "YEARLY" ? PRICES[o.sub!.plan_tier][1] / 12 : PRICES[o.sub!.plan_tier][0]), 0)) };
  }).filter((r) => r.subscribers > 0);
  const t0 = Date.now();
  const fm = round2(expensesDemo.filter((e) => e.frequency === "MONTHLY" && t0 - new Date(e.spent_on).getTime() < 31 * DAY).reduce((a, e) => a + e.net_amount, 0));
  const fy = round2(expensesDemo.filter((e) => e.frequency === "YEARLY" && t0 - new Date(e.spent_on).getTime() < 365 * DAY).reduce((a, e) => a + e.net_amount, 0) / 12);
  return { period, from, to, revenue: { total: revenue, by_source: bySource, by_cycle: byCycle }, mrr_split: mrrSplit,
    fixed_costs: { monthly: fm, yearly_share: fy, total: round2(fm + fy) }, expenses: { total: expenses, by_category: byCat },
    net_profit: round2(revenue - expenses), margin: revenue ? (revenue - expenses) / revenue : null,
    vat: { output: out, input: inp, payable: round2(out - inp) }, monthly: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    mrr: overview().kpis.mrr_sar ?? 0, renewals_due: due, renewals_expected: due.reduce((a, d) => a + d.expected, 0),
    installments_due: installmentsDue(), installments_overdue_total: round2(installmentsDue().filter((i) => i.overdue).reduce((a, i) => a + i.amount_net, 0)) };
}
const invoiceRow = (i: DemoInvoice) => ({ id: i.id, number: i.number, kind: i.kind, source: i.source, org_id: i.org_id, buyer_name: i.buyer_name,
  subtotal: i.subtotal, vat_amount: i.vat_amount, total: i.total, issued_at: i.issued_at, status: i.status, payment_reference: i.payment_reference,
  related_number: invoicesDemo.find((r) => r.id === i.related_invoice_id)?.number ?? null, plan_cycle: i.plan_cycle });

function finStatement(view: "monthly" | "yearly", year: number, years: number, allocate: boolean) {
  const cols = view === "monthly" ? Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`)
    : Array.from({ length: years }, (_, i) => String(year - years + 1 + i));
  const key = (ym: string) => (view === "monthly" ? ym : ym.slice(0, 4));
  const idx = new Map(cols.map((c, i) => [c, i]));
  const add = (m: Map<string, number[]>, k: string, col: string, v: number) => {
    const i = idx.get(col); if (i === undefined) return;
    const arr = m.get(k) ?? new Array(cols.length).fill(0); arr[i] += v; m.set(k, arr);
  };
  const rev = new Map<string, number[]>();
  for (const i of invoicesDemo) add(rev, i.source === "SUBSCRIPTION" ? i.plan_cycle ?? "YEARLY" : i.source, key(i.issued_at.slice(0, 7)), (i.kind === "INVOICE" ? 1 : -1) * i.subtotal);
  const exp = new Map<string, number[]>();
  for (const e of expensesDemo) {
    const parts: [string, number][] = allocate && e.frequency === "YEARLY"
      ? Array.from({ length: 12 }, (_, k) => [addMonthsIso(e.spent_on, k).slice(0, 7), e.net_amount / 12])
      : [[e.spent_on.slice(0, 7), e.net_amount]];
    for (const [ym, v] of parts) add(exp, e.category, key(ym), v);
  }
  const row = (group: string, k: string, label: string, vals: number[]) => {
    const values = vals.map(round2); return { group, key: k, label, values, total: round2(values.reduce((a, b) => a + b, 0)) };
  };
  const REV: [string, string][] = [["MONTHLY", "اشتراكات شهرية"], ["YEARLY", "اشتراكات سنوية"], ["CONSULTATION", "استشارات قانونية"], ["MANUAL", "إيرادات أخرى"]];
  const revenue = REV.filter(([k]) => rev.has(k)).map(([k, l]) => row("revenue", k, l, rev.get(k)!));
  const revTot = cols.map((_, i) => revenue.reduce((a, r) => a + r.values[i], 0));
  const expenses = [...exp.entries()].map(([k, v]) => row("expenses", k, EXPENSE_CATEGORY[k] ?? k, v)).sort((a, b) => b.total - a.total);
  const expTot = cols.map((_, i) => expenses.reduce((a, r) => a + r.values[i], 0));
  return { view, columns: cols, allocate, revenue, revenue_total: row("total", "revenue", "إجمالي الإيرادات", revTot),
    expenses, expenses_total: row("total", "expenses", "إجمالي المصروفات", expTot),
    net: row("net", "net", "صافي الربح (الخسارة)", cols.map((_, i) => revTot[i] - expTot[i])) };
}

function financeRoute(method: string, p: string, q: URLSearchParams, body: Record<string, unknown>, who: string): unknown {
  let m: RegExpMatchArray | null;
  if (p === "/admin/finance/summary") return finSummary(q.get("period") ?? new Date().toISOString().slice(0, 7));
  if (p === "/admin/finance/invoices") {
    const per = q.get("period"), s = (q.get("q") ?? "").trim(), cy = q.get("cycle");
    const r = per ? periodRange(per) : null;
    return invoicesDemo.filter((i) => (!r || (i.issued_at.slice(0, 10) >= r.from && i.issued_at.slice(0, 10) < r.to))
      && (!s || i.number.includes(s) || i.buyer_name.includes(s))
      && (!cy || (cy === "CONSULTATION" ? i.source === "CONSULTATION" : i.source === "SUBSCRIPTION" && i.plan_cycle === cy))).map(invoiceRow);
  }
  if ((m = p.match(/^\/admin\/finance\/invoices\/([^/]+)\/void$/))) {
    const inv = invoicesDemo.find((i) => i.id === m![1]); if (!inv) throw new DemoError(404, "الفاتورة غير موجودة");
    if (String(body.reason ?? "").trim().length < 5) throw new DemoError(422, "اكتب سبب الإلغاء");
    const cn = voidInvoice(inv, String(body.reason));
    log("ADMIN_INVOICE_VOID", null, { reason: body.reason, credit_note: cn.number });
    return { credit_note: { id: cn.id, number: cn.number } };
  }
  if ((m = p.match(/^\/admin\/finance\/invoices\/([^/]+)$/))) {
    const i = invoicesDemo.find((x) => x.id === m![1]); if (!i) throw new DemoError(404, "الفاتورة غير موجودة");
    const cn = invoicesDemo.find((x) => x.related_invoice_id === i.id);
    return { ...i, ...invoiceRow(i), credit_note_number: cn?.number ?? null, credit_note_id: cn?.id ?? null };
  }
  if (p === "/admin/finance/expenses" && method === "GET") {
    const per = q.get("period"), fr = q.get("frequency"); const r = per ? periodRange(per) : null;
    return expensesDemo.filter((e) => (!r || (e.spent_on >= r.from && e.spent_on < r.to)) && (!fr || e.frequency === fr));
  }
  const expenseBody = () => {
    const net = Number(body.net_amount), vat = Number(body.vat_amount ?? 0);
    if (!(net > 0)) throw new DemoError(422, "أدخل المبلغ قبل الضريبة");
    if (vat < 0 || vat > net * 0.15 + 0.05) throw new DemoError(422, "ضريبة المدخلات أكبر من 15% من المبلغ");
    if (String(body.vendor ?? "").trim().length < 2) throw new DemoError(422, "اكتب اسم المورّد");
    if (!EXPENSE_CATEGORY[String(body.category)]) throw new DemoError(422, "اختر البند");
    return { spent_on: String(body.spent_on), category: String(body.category), vendor: String(body.vendor), description: (body.description as string) || null,
      net_amount: round2(net), vat_amount: round2(vat), total: round2(net + vat), reference: (body.reference as string) || null,
      frequency: (["MONTHLY", "YEARLY"].includes(String(body.frequency)) ? body.frequency : "ONE_TIME") as DemoExpense["frequency"] };
  };
  if (p === "/admin/finance/expenses" && method === "POST") {
    const e = { id: uid(), ...expenseBody(), created_at: new Date().toISOString(), created_by_name: who };
    expensesDemo.unshift(e); expensesDemo.sort((a, b) => b.spent_on.localeCompare(a.spent_on));
    log("ADMIN_EXPENSE_ADD", null, { category: e.category, amount_sar: e.net_amount, vendor: e.vendor }); return { id: e.id };
  }
  if ((m = p.match(/^\/admin\/finance\/expenses\/([^/]+)$/))) {
    const i = expensesDemo.findIndex((x) => x.id === m![1]); if (i < 0) throw new DemoError(404, "المصروف غير موجود");
    if (method === "DELETE") { const [e] = expensesDemo.splice(i, 1); log("ADMIN_EXPENSE_DELETE", null, { vendor: e.vendor, amount_sar: e.net_amount }); return { deleted: true }; }
    Object.assign(expensesDemo[i], expenseBody()); log("ADMIN_EXPENSE_UPDATE", null, { vendor: body.vendor, amount_sar: body.net_amount }); return { updated: true };
  }
  if (p === "/admin/finance/vat") {
    const per = q.get("period") ?? ""; if (!/^\d{4}-Q[1-4]$/.test(per)) throw new DemoError(422, "الفترة: 2026-Q4");
    const { from, to } = periodRange(per);
    const inv = invoicesDemo.filter((i) => i.vat_amount > 0 && i.issued_at.slice(0, 10) >= from && i.issued_at.slice(0, 10) < to);
    const ex = expensesDemo.filter((e) => e.spent_on >= from && e.spent_on < to);
    const sales = { sales: round2(inv.filter((i) => i.kind === "INVOICE").reduce((a, i) => a + i.subtotal, 0)),
      adjustments: round2(inv.filter((i) => i.kind === "CREDIT_NOTE").reduce((a, i) => a + i.subtotal, 0)),
      vat: round2(inv.reduce((a, i) => a + (i.kind === "INVOICE" ? 1 : -1) * i.vat_amount, 0)) };
    const purchases = { purchases: round2(ex.filter((e) => e.vat_amount > 0).reduce((a, e) => a + e.net_amount, 0)), vat: round2(ex.reduce((a, e) => a + e.vat_amount, 0)) };
    const end = new Date(`${to}T00:00:00Z`); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
    return { period: per, from, to, sales, purchases, payable: round2(sales.vat - purchases.vat), file_by: end.toISOString().slice(0, 10) };
  }
  if (p === "/admin/finance/statement") return finStatement(q.get("view") === "yearly" ? "yearly" : "monthly",
    Number(q.get("year")) || new Date().getUTCFullYear(), Number(q.get("years")) || 3, q.get("allocate") !== "false");
  if (p === "/admin/finance/profile" && method === "GET") return { ...finProfile };
  if (p === "/admin/finance/profile" && method === "PUT") {
    if (body.vat_registered && !/^3\d{13}3$/.test(String(body.vat_number ?? ""))) throw new DemoError(422, "أدخل الرقم الضريبي (15 رقماً يبدأ وينتهي بـ 3)");
    Object.assign(finProfile, body); log("ADMIN_FINANCE_PROFILE", null, { vat_registered: !!body.vat_registered }); return { updated: true };
  }
  throw new DemoError(404, "غير موجود");
}


// ---------- الاشتراك السنوي بالأقساط (نسخة العرض) — مطابق لـ installments_service.py ----------
type DemoInst = { id: string; seq: number; due_date: string; amount_net: number; paid_at: string | null; payment_reference: string | null;
  invoice_id: string | null; reminders: { stage: string; channel: string; at: string }[] };
type DemoPlan = { id: string; org_id: string; plan_tier: string; total_net: number; installments: number; starts_on: string; ends_on: string;
  status: "ACTIVE" | "COMPLETED" | "CANCELED"; note: string | null; created_at: string; items: DemoInst[] };
const plansDemo: DemoPlan[] = [];
const riyadhDate = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
function addMonthsIso(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}
function buildPlan(org: Org, tier: string, n: number, starts: string, total: number, note: string | null): DemoPlan {
  if (![1, 2, 3, 4, 6, 12].includes(n)) throw new DemoError(422, "عدد الأقساط: 1 أو 2 أو 3 أو 4 أو 6 أو 12");
  const each = round2(total / n), step = 12 / n;
  const items = Array.from({ length: n }, (_, i) => ({ id: uid(), seq: i + 1, due_date: addMonthsIso(starts, i * step),
    amount_net: i === n - 1 ? round2(total - each * (n - 1)) : each, paid_at: null, payment_reference: null, invoice_id: null, reminders: [] as DemoInst["reminders"] }));
  return { id: uid(), org_id: org.id, plan_tier: tier, total_net: round2(total), installments: n, starts_on: starts, ends_on: addMonthsIso(starts, 12),
    status: "ACTIVE", note, created_at: new Date().toISOString(), items };
}
function planHead(p: DemoPlan) {
  const t = riyadhDate(), unpaid = p.items.filter((i) => !i.paid_at);
  return { id: p.id, org_id: p.org_id, org_name: orgs.find((o) => o.id === p.org_id)?.name ?? "—", plan_tier: p.plan_tier, total_net: p.total_net,
    installments: p.installments, starts_on: p.starts_on, ends_on: p.ends_on, status: p.status, note: p.note, created_at: p.created_at,
    paid_net: round2(p.items.filter((i) => i.paid_at).reduce((a, i) => a + i.amount_net, 0)), remaining_net: round2(unpaid.reduce((a, i) => a + i.amount_net, 0)),
    paid_count: p.items.length - unpaid.length, next_due: unpaid[0]?.due_date ?? null, overdue_count: unpaid.filter((i) => i.due_date < t).length };
}
function planDetail(p: DemoPlan) {
  return { ...planHead(p), items: p.items.map((i) => ({ id: i.id, seq: i.seq, due_date: i.due_date, amount_net: i.amount_net, paid_at: i.paid_at,
    payment_reference: i.payment_reference, invoice_id: i.invoice_id, invoice_number: invoicesDemo.find((v) => v.id === i.invoice_id)?.number ?? null,
    last_reminder_at: i.reminders.at(-1)?.at ?? null, reminders: i.reminders.length })) };
}
function payInst(p: DemoPlan, i: DemoInst, ref: string | null, who: string, at?: string) {
  if (i.paid_at) throw new DemoError(409, "القسط مدفوع أصلاً");
  if (p.status !== "ACTIVE") throw new DemoError(409, "خطة الدفع غير فعّالة");
  const o = orgs.find((x) => x.id === p.org_id)!;
  const note = `القسط ${i.seq} من ${p.installments}`;
  const inv = subscriptionInvoice(o, p.plan_tier, i.amount_net, 12 / p.installments, ref, at, note);
  if (!at) o.billing.unshift({ event_type: "PAYMENT", plan_tier: p.plan_tier, amount_sar: i.amount_net, period_months: 12 / p.installments,
    reference: ref, note, created_at: new Date().toISOString(), actor: who });
  Object.assign(i, { paid_at: at ?? new Date().toISOString(), payment_reference: ref, invoice_id: inv.id });
  if (p.items.every((x) => x.paid_at)) p.status = "COMPLETED";
  return inv;
}
// خطة منشأة العرض: سنوي بأربعة أقساط، القسط الأول مدفوع (فاتورته صدرت من سجل الدفعات أعلاه)
(() => {
  const o = orgs.find((x) => x.id === ORG_A)!;
  const p = buildPlan(o, "PROFESSIONAL_GRC", 4, ts(-10).slice(0, 10), 4990, "اتفاق تقسيط ربعي");
  p.created_at = ts(-10);
  const first = invoicesDemo.find((v) => v.org_id === ORG_A && v.source === "SUBSCRIPTION");
  Object.assign(p.items[0], { paid_at: ts(-10), payment_reference: "INV-2026-0007", invoice_id: first?.id ?? null });
  plansDemo.push(p);
})();

function plansRoute(method: string, p: string, q: URLSearchParams, body: Record<string, unknown>, who: string): unknown {
  let m: RegExpMatchArray | null;
  if (p === "/admin/finance/plans" && method === "GET") {
    const st = q.get("status"), org = q.get("org_id");
    return plansDemo.filter((x) => (!st || x.status === st) && (!org || x.org_id === org)).map(planHead)
      .sort((a, b) => Number(b.status === "ACTIVE") - Number(a.status === "ACTIVE") || (a.next_due ?? "9").localeCompare(b.next_due ?? "9"));
  }
  if (p === "/admin/finance/plans" && method === "POST") {
    const o = orgs.find((x) => x.id === body.org_id); if (!o) throw new DemoError(404, "المنشأة غير موجودة");
    if (plansDemo.some((x) => x.org_id === o.id && x.status === "ACTIVE")) throw new DemoError(409, "لدى المنشأة خطة دفع فعّالة؛ ألغها أو أكملها أولاً");
    const tier = String(body.plan_tier), total = body.total_net ? Number(body.total_net) : PRICES[tier][1];
    const plan = buildPlan(o, tier, Number(body.installments), String(body.starts_on), total, (body.note as string) || null);
    plansDemo.unshift(plan);
    o.sub = { id: o.sub?.id ?? uid(), plan_tier: tier, billing_cycle: "YEARLY", billing_status: "ACTIVE", starts_at: `${plan.starts_on}T00:00:00Z`, ends_at: `${plan.ends_on}T00:00:00Z` };
    log("ADMIN_PLAN_CREATE", o, { plan: tier, installments: plan.installments, amount_sar: total });
    const inv = body.pay_first ? payInst(plan, plan.items[0], (body.first_reference as string) || null, who) : null;
    return { id: plan.id, invoice: inv ? { id: inv.id, number: inv.number } : null };
  }
  if ((m = p.match(/^\/admin\/finance\/plans\/([^/]+)$/))) {
    const plan = plansDemo.find((x) => x.id === m![1]); if (!plan) throw new DemoError(404, "خطة الدفع غير موجودة");
    return planDetail(plan);
  }
  if ((m = p.match(/^\/admin\/finance\/plans\/([^/]+)\/cancel$/))) {
    const plan = plansDemo.find((x) => x.id === m![1]); if (!plan || plan.status !== "ACTIVE") throw new DemoError(409, "الخطة غير فعّالة");
    plan.status = "CANCELED"; log("ADMIN_PLAN_CANCEL", null, { reason: body.reason }); return { status: "CANCELED" };
  }
  if ((m = p.match(/^\/admin\/finance\/plans\/([^/]+)\/installments\/([^/]+)\/(pay|remind)$/))) {
    const plan = plansDemo.find((x) => x.id === m![1]); const inst = plan?.items.find((i) => i.id === m![2]);
    if (!plan || !inst) throw new DemoError(404, "القسط غير موجود");
    if (m[3] === "pay") {
      const inv = payInst(plan, inst, (body.reference as string) || null, who);
      log("ADMIN_INSTALLMENT_PAID", orgs.find((o) => o.id === plan.org_id) ?? null, { amount_sar: inv.total, reference: body.reference, invoice: inv.number });
      return { invoice: { id: inv.id, number: inv.number } };
    }
    if (inst.paid_at) throw new DemoError(409, "القسط غير موجود أو مدفوع");
    const o = orgs.find((x) => x.id === plan.org_id)!;
    const recs = o.members.filter((x) => x.role === "ORG_ADMIN" && x.active);
    let n = 0;
    for (const r of recs) for (const [ch, to] of [["EMAIL", r.email], ["WHATSAPP", r.phone]] as const) if (to) { inst.reminders.push({ stage: "MANUAL", channel: ch, at: new Date().toISOString() }); n++; }
    log("ADMIN_INSTALLMENT_REMIND", o, { sent: n });
    return { sent: n };
  }
  throw new DemoError(404, "غير موجود");
}
function installmentsDue() {
  const t = riyadhDate(), lim = addMonthsIso(t, 1);
  return plansDemo.filter((x) => x.status === "ACTIVE").flatMap((x) => x.items.filter((i) => !i.paid_at && i.due_date < lim).map((i) => ({
    id: i.id, plan_id: x.id, seq: i.seq, installments: x.installments, due_date: i.due_date, amount_net: i.amount_net, org_id: x.org_id,
    name: orgs.find((o) => o.id === x.org_id)?.name ?? "—", overdue: i.due_date < t })))
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
}

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

const alertRules: Record<"COMPLIANCE_ITEM" | "POLICY" | "EMPLOYEE_DOC" | "LABOR_TASK" | "TAX_TASK", { target_type: string; days_before: number[]; channels: string[]; is_enabled: boolean; is_default: boolean }> = {
  COMPLIANCE_ITEM: { target_type: "COMPLIANCE_ITEM", days_before: [60, 30, 14, 7, 3, 1, 0], channels: ["WHATSAPP", "EMAIL"], is_enabled: true, is_default: true },
  POLICY: { target_type: "POLICY", days_before: [30, 14, 7, 0], channels: ["EMAIL", "WHATSAPP"], is_enabled: true, is_default: true },
  EMPLOYEE_DOC: { target_type: "EMPLOYEE_DOC", days_before: [60, 30, 14, 7, 3, 1, 0], channels: ["WHATSAPP", "EMAIL"], is_enabled: true, is_default: true },
  LABOR_TASK: { target_type: "LABOR_TASK", days_before: [5, 1, 0], channels: ["WHATSAPP", "EMAIL"], is_enabled: true, is_default: true },
  TAX_TASK: { target_type: "TAX_TASK", days_before: [10, 3, 1, 0], channels: ["WHATSAPP", "EMAIL"], is_enabled: true, is_default: true },
};

// ---------- العمل والموظفين (منشأة النخبة)
type DemoEmp = Omit<Employee, "basic_wage" | "housing_allowance"> & { basic_wage: number; housing_allowance: number };
const employeesDemo: DemoEmp[] = (() => {
  const e = (full_name: string, nationality: Nationality, job_title: string, startDays: number, basic: number, housing: number,
    o: Partial<DemoEmp> = {}): DemoEmp => ({ id: uid(), full_name, nationality, job_title, start_date: inDays(-startDays), gosi_system: startDays < 820 ? "NEW" : "OLD",
    basic_wage: basic, housing_allowance: housing, gosi_registered: true, qiwa_contract_documented: true, contract_end_date: null,
    probation_end_date: null, iqama_expiry: nationality === "NON_SAUDI" ? inDays(200 + startDays % 300) : null,
    work_permit_expiry: nationality === "NON_SAUDI" ? inDays(200 + startDays % 300) : null, is_active: true, left_on: null, ...o });
  return [
    e("أحمد العتيبي", "SAUDI", "المدير العام", 2400, 18000, 4500),
    e("ريم السبيعي", "SAUDI", "مسؤولة حماية البيانات", 900, 12000, 3000),
    e("فهد القحطاني", "SAUDI", "مدير المشاريع", 1500, 14000, 3500),
    e("نورة الدوسري", "SAUDI", "محاسبة", 400, 8000, 2000, { contract_end_date: inDays(45) }),
    e("سلطان المطيري", "SAUDI", "مهندس موقع", 70, 9000, 2250, { probation_end_date: inDays(20), qiwa_contract_documented: false }),
    e("عبدالله الشهري", "SAUDI", "مشرف سلامة", 1100, 7000, 1750),
    e("محمد رفيق", "NON_SAUDI", "فني كهرباء", 1300, 3000, 750, { iqama_expiry: inDays(12), work_permit_expiry: inDays(12) }),
    e("جون ماثيو", "NON_SAUDI", "مهندس مدني", 950, 9500, 2375, { iqama_expiry: inDays(55), work_permit_expiry: inDays(55) }),
    e("أحمد حسن", "NON_SAUDI", "مراقب جودة", 600, 5000, 1250, { qiwa_contract_documented: false, contract_end_date: inDays(28) }),
    e("رامش كومار", "NON_SAUDI", "سائق معدات", 1700, 2500, 625),
    e("علي منصور", "NON_SAUDI", "نجار", 500, 2800, 700, { gosi_registered: false }),
    e("كريم يوسف", "NON_SAUDI", "عامل", 300, 1800, 450, { iqama_expiry: inDays(-3), work_permit_expiry: inDays(-3) }),
  ];
})();
let laborProfileDemo: LaborProfile | null = { salary_day: 27, nitaqat_band: "MID_GREEN", nitaqat_checked_on: inDays(-20), gosi_employer_no: "500123456" };
type DemoTask = { id: string; period: string; kind: LaborTaskKind; due_date: string; amount: number | null; done_at: string | null; reference: string | null; done_by_name: string | null };
const laborTasksDemo: DemoTask[] = [];
function gosiMonthDemo(period: string) {
  const end = addMonthsIso(period, 1);
  const lines = employeesDemo.filter((x) => x.is_active && x.start_date < end).flatMap((x) => {
    const r = pickRate(GOSI_RATES, rateSystem(x.nationality, x.gosi_system), period);
    return r ? [{ employee_id: x.id, full_name: x.full_name, nationality: x.nationality, gosi_system: x.gosi_system, gosi_registered: x.gosi_registered,
      ...contribution(x.basic_wage, x.housing_allowance, r) }] : [];
  }).sort((a, b) => a.full_name.localeCompare(b.full_name, "ar"));
  const employee_total = round2(lines.reduce((a, l) => a + l.employee, 0)), employer_total = round2(lines.reduce((a, l) => a + l.employer, 0));
  return { period, employee_total, employer_total, total: round2(employee_total + employer_total), lines };
}
function ensureLaborTasks() {
  if (!laborProfileDemo) return;
  const today = iso(riyadhToday()), cur = monthStart(today);
  const first = laborTasksDemo.length === 0;
  const periods = first ? [-3, -2, -1, 0].map((n) => addMonthsIso(cur, n)) : periodsToPlan(today);
  for (const period of periods) for (const kind of TASK_KINDS) {
    if (laborTasksDemo.some((t) => t.period === period && t.kind === kind)) continue;
    const due = taskDueDate(kind, period, laborProfileDemo.salary_day);
    // مثال تجريبي: ملف حماية الأجور لما قبل الشهر الماضي لم يُرفع بعد (متأخر)
    const done = first && due < today && !(period === addMonthsIso(cur, -2) && kind === "WPS_UPLOAD");
    laborTasksDemo.push({ id: uid(), period, kind, due_date: due, amount: kind === "GOSI_PAYMENT" ? gosiMonthDemo(period).total : null,
      done_at: done ? `${addDays(due, -2)}T09:00:00.000Z` : null, reference: done ? (kind === "GOSI_PAYMENT" ? `SADAD-${period.slice(0, 7).replace("-", "")}` : null) : null,
      done_by_name: done ? "أحمد العتيبي" : null });
  }
}
function addDays(d: string, n: number) { return iso(new Date(new Date(`${d}T00:00:00Z`).getTime() + n * DAY)); }
function laborOverviewDemo() {
  ensureLaborTasks();
  const today = iso(riyadhToday()), from = addMonthsIso(monthStart(today), -3);
  const tasks = laborTasksDemo.filter((t) => !t.done_at || t.period >= from)
    .sort((a, b) => b.period.localeCompare(a.period) || a.due_date.localeCompare(b.due_date))
    .map((t) => {
      const left = daysLeft(t.due_date), overdue = !t.done_at && left < 0;
      return { ...t, label: TASK_LABEL[t.kind], days_left: left, overdue,
        ...(overdue && t.kind === "GOSI_PAYMENT" && t.amount ? { penalty_estimate: gosiLatePenalty(t.amount, t.due_date, today) } : {}) };
    });
  const active = employeesDemo.filter((x) => x.is_active);
  const documents = active.flatMap((x) => (([["IQAMA", x.iqama_expiry], ["WORK_PERMIT", x.work_permit_expiry], ["CONTRACT_END", x.contract_end_date],
    ["PROBATION_END", x.probation_end_date]] as [string, string | null][])
    .filter(([, d]) => d && daysLeft(d) <= 90)
    .map(([kind, d]) => ({ employee_id: x.id, full_name: x.full_name, kind, label: EMP_DOC_LABEL[kind], due_date: d!, days_left: daysLeft(d!) }))))
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const g = gosiMonthDemo(monthStart(today));
  return { enabled: !!laborProfileDemo, profile: laborProfileDemo, tasks: laborProfileDemo ? tasks : [], hr: true, can_manage: true, today,
    indicators: qiwaIndicators(active), documents, gosi_month: { period: g.period, employee_total: g.employee_total, employer_total: g.employer_total, total: g.total } };
}
function mobileOf(v: unknown): string | null {
  const x = String(v ?? "").trim();
  if (!x) return null;
  if (!/^\+9665\d{8}$/.test(x)) throw new DemoError(422, "الجوال بصيغة ‎+9665XXXXXXXX");
  return x;
}
function empInput(b: Record<string, unknown>): Omit<DemoEmp, "id" | "is_active" | "left_on"> {
  const name = String(b.full_name ?? "").trim();
  if (name.length < 2) throw new DemoError(422, "اكتب اسم الموظف");
  if (!b.start_date) throw new DemoError(422, "حدد تاريخ المباشرة");
  const saudi = b.nationality === "SAUDI";
  return { full_name: name, nationality: saudi ? "SAUDI" : "NON_SAUDI", job_title: (b.job_title as string) || null, start_date: String(b.start_date),
    gosi_system: b.gosi_system === "NEW" ? "NEW" : "OLD", basic_wage: Number(b.basic_wage) || 0, housing_allowance: Number(b.housing_allowance) || 0,
    gosi_registered: !!b.gosi_registered, qiwa_contract_documented: !!b.qiwa_contract_documented,
    contract_end_date: (b.contract_end_date as string) || null, probation_end_date: (b.probation_end_date as string) || null,
    iqama_expiry: saudi ? null : (b.iqama_expiry as string) || null, work_permit_expiry: saudi ? null : (b.work_permit_expiry as string) || null,
    mobile: mobileOf(b.mobile) };
}
const recipients = [
  { membership_id: "rcp-ahmad", full_name: "أحمد العتيبي", email: "demo@haseef.sa", phone: "+966500000001", role: "ORG_ADMIN", receives_alerts: true, alert_channels: ["EMAIL", "WHATSAPP"], is_me: true },
  { membership_id: "rcp-reem", full_name: "ريم السبيعي", email: "reem@nukhba.example", phone: "+966500000011", role: "DPO", receives_alerts: true, alert_channels: ["EMAIL"], is_me: false },
  { membership_id: "rcp-adv", full_name: "مكتب المستشار القانوني", email: "advisor@example.sa", phone: null, role: "EXTERNAL_ADVISOR", receives_alerts: false, alert_channels: [], is_me: false },
];
function alertsOverview() {
  const today = riyadhToday().getTime();
  const upcoming: { target_type: string; target_id: string; title: string; due_date: string; alert_on: string; threshold_days: number; channels: string[] }[] = [];
  const add = (type: string, id: string, title: string, due: string, ruleKey: keyof typeof alertRules = type as keyof typeof alertRules) => {
    const rule = alertRules[ruleKey];
    if (!rule.is_enabled) return;
    const left = daysLeft(due);
    const t = [...rule.days_before].sort((a, b) => b - a).find((x) => x <= left);
    if (t === undefined) return;
    const on = iso(new Date(new Date(`${due}T00:00:00Z`).getTime() - t * DAY));
    if (new Date(`${on}T00:00:00Z`).getTime() - today <= 60 * DAY) upcoming.push({ target_type: type, target_id: id, title, due_date: due, alert_on: on, threshold_days: t, channels: rule.channels });
  };
  for (const i of items) add("COMPLIANCE_ITEM", i.id, i.title, i.expiry_date);
  for (const x of policies) if (x.status === "ACTIVE") add("POLICY", x.id, x.title, x.review_due_date);
  const lab = laborOverviewDemo();
  for (const d of lab.documents) add(d.kind, d.employee_id, `${d.label} — ${d.full_name}`, d.due_date, "EMPLOYEE_DOC");
  for (const t of lab.tasks) if (!t.done_at) add("LABOR_TASK", t.id, `${t.label} لشهر ${t.period.slice(5, 7)}/${t.period.slice(0, 4)}`, t.due_date);
  for (const t of taxOverviewDemo().tasks) if (!t.done_at) add("TAX_TASK", t.id, `${t.label} عن ${t.period_label}`, t.due_date);
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

// ---------- النمو: التسعير والتسجيل الذاتي والدفع والضريبة والتقويم والبوت (نسخة العرض) ----------
const QUOTA: Record<string, number | null> = { ESSENTIAL: 200, PROFESSIONAL_GRC: 1000, ENTERPRISE: null };
type DemoAddonLimits = { members: number | null; questions: number | null; included_unlimited: boolean; grants?: string[]; extra_members_block?: number; extra_block_price?: number };
const addonCatalog = [{ code: "WA_BOT", name: "بوت واتساب للموظفين", monthly_price: 99, included_tiers: ["ENTERPRISE"],
  limits: { members: 50, questions: 1000, included_unlimited: true, extra_members_block: 50, extra_block_price: 49 } as DemoAddonLimits, is_active: true },
  { code: "ATTENDANCE", name: "الموارد البشرية — حتى 25 موظفاً", monthly_price: 149, included_tiers: ["ENTERPRISE"],
    limits: { members: 25 as number | null, questions: null as number | null, included_unlimited: true } as DemoAddonLimits, is_active: true },
  { code: "ATTENDANCE_75", name: "الموارد البشرية — حتى 75 موظفاً", monthly_price: 249, included_tiers: ["ENTERPRISE"],
    limits: { members: 75, questions: null, included_unlimited: true, grants: ["ATTENDANCE"] } as DemoAddonLimits, is_active: true },
  { code: "ATTENDANCE_200", name: "الموارد البشرية — حتى 200 موظف", monthly_price: 399, included_tiers: ["ENTERPRISE"],
    limits: { members: 200, questions: null, included_unlimited: true, grants: ["ATTENDANCE"] } as DemoAddonLimits, is_active: true },
  { code: "STAFF_BUNDLE", name: "حزمة الموظفين: الموارد البشرية + بوت الواتساب — حتى 25 موظفاً", monthly_price: 199, included_tiers: ["ENTERPRISE"],
    limits: { members: 25, questions: 1000, included_unlimited: true, grants: ["ATTENDANCE", "WA_BOT"] } as DemoAddonLimits, is_active: true }];
const pricingView = () => ({
  plans: Object.entries(PRICES).map(([tier, [m, y]]) => ({ tier, name_ar: PLAN_AR[tier], monthly_price_sar: m, yearly_price_sar: y, monthly_whatsapp_alerts: QUOTA[tier] }))
    .sort((a, b) => a.monthly_price_sar - b.monthly_price_sar),
  addons: addonCatalog.map((a) => ({ ...a, included_tiers: [...a.included_tiers], limits: { ...a.limits, ...(a.limits.grants ? { grants: [...a.limits.grants] } : {}) } })),
});
const addonPaidUntil: Record<string, string | null> = { WA_BOT: ts(21), ATTENDANCE: ts(15) };
// عرض الإطلاق (نسخة العرض): مرة واحدة لكل منشأة، لأول 50 مشتركاً
const promoDemo = { code: "HR_LAUNCH", name: "عرض الإطلاق: شهر مجاني على الموارد البشرية لأول 50 مشتركاً", free_months: 1, max: 50, used: 7, is_active: true,
  claimed: false };
const hrTiersDemo = () => addonCatalog.filter((a) => a.is_active && (a.code === "ATTENDANCE" || (a.limits.grants?.length === 1 && a.limits.grants[0] === "ATTENDANCE")))
  .sort((a, b) => (a.limits.members ?? 1e9) - (b.limits.members ?? 1e9));
const tierForDemo = (n: number) => hrTiersDemo().find((a) => (a.limits.members ?? 1e9) >= n) ?? null;
function promoView(withOrg: boolean): PromoStatus {
  const active = promoDemo.is_active && promoDemo.used < promoDemo.max;
  const base = { code: promoDemo.code, name: promoDemo.name, free_months: promoDemo.free_months, remaining: Math.max(promoDemo.max - promoDemo.used, 0), active,
    max: promoDemo.max, used: promoDemo.used, is_active: promoDemo.is_active };
  if (!withOrg) return base;
  const o = orgs.find((x) => x.id === ORG_A)!;
  const n = employeesDemo.filter((e) => e.is_active).length, tier = tierForDemo(n);
  const reason = promoDemo.claimed ? "استفدت من العرض مسبقاً" : !active ? "انتهى العرض" : o.sub?.billing_status !== "ACTIVE" ? "العرض للمشتركين باشتراك مدفوع ساري"
    : addonAccess("ATTENDANCE").via === "PLAN" ? "الموارد البشرية مشمولة في باقتك"
    : ["ATTENDANCE", "ATTENDANCE_75", "ATTENDANCE_200", "STAFF_BUNDLE"].some((c) => addonPaidUntil[c]) ? "العرض لمن لم يشترك في الموارد البشرية من قبل"
    : !tier ? `عدد موظفيك (${n}) أكبر من شرائح الإضافة؛ باقة كبار العملاء تشملها بلا حد` : null;
  return { ...base, eligible: !reason, reason, ...(tier && !reason ? { tier_code: tier.code, tier_name: tier.name } : {}) };
}
function hrMixDemo() {
  const now = new Date().toISOString(), live = (c: string) => (addonPaidUntil[c] ?? "") > now;
  const bundle = live("STAFF_BUNDLE") ? 1 : 0, hr = ["ATTENDANCE", "ATTENDANCE_75", "ATTENDANCE_200"].some(live) ? 1 : 0;
  return { bundle, hr_only: hr, bundle_share: bundle + hr ? Math.round((bundle / (bundle + hr)) * 1000) / 1000 : 0, threshold: 0.6, suggest_raise: false, suggested_bundle_price: 229 };
}
function addonAccess(code: string) {
  const o = orgs.find((x) => x.id === ORG_A)!; const a = addonCatalog.find((x) => x.code === code)!;
  const tier = o.sub?.plan_tier ?? null;
  const base = { code: a.code, name: a.name, price: a.monthly_price, via: null as "PLAN" | "ADDON" | null, paid_until: null as string | null, limits: {}, plan_tier: tier };
  if (!a.is_active || !tier) return base;
  const lim = code === "WA_BOT" ? { members: a.limits.members, questions: a.limits.questions } : { members: a.limits.members };
  if (a.included_tiers.includes(tier)) return { ...base, via: "PLAN" as const, limits: a.limits.included_unlimited ? {} : lim };
  const now = new Date().toISOString();
  const until = addonPaidUntil[code];
  let out: typeof base & { granted_by?: string } = until && until > now ? { ...base, via: "ADDON" as const, paid_until: until, limits: lim } : base;
  // شريحة أكبر أو حزمة تمنح هذه الإضافة: تؤخذ الأوسع حدوداً
  for (const g of addonCatalog.filter((x) => x.is_active && x.limits.grants?.includes(code))) {
    const gu = addonPaidUntil[g.code];
    if (!gu || gu <= now) continue;
    const gl = { ...lim, members: g.limits.members, ...(code === "WA_BOT" ? { questions: g.limits.questions } : {}) };
    const mine = out.via ? ((out.limits as { members?: number | null }).members ?? 1e9) : -1;
    if ((g.limits.members ?? 1e9) > mine) out = { ...base, via: "ADDON" as const, paid_until: gu, limits: gl, granted_by: g.code };
  }
  return out;
}
const botAccess = () => addonAccess("WA_BOT");

// التسجيل والإعداد
let onboardingNeeded = false;
let emailVerified = true;
const onboardingState = () => {
  const o = orgs.find((x) => x.id === ORG_A)!;
  return { name: o.name, entity_legal_type: o.legal, commercial_size: o.size, industry_type: o.industry, onboarded_at: onboardingNeeded ? null : o.created_at,
    signup_source: onboardingNeeded ? "SELF" : "ADMIN", email_verified: emailVerified, phone_number: "+966500000001", plan_tier: o.sub?.plan_tier ?? null,
    billing_status: o.sub?.billing_status ?? null, ends_at: o.sub?.ends_at ?? null, needs_onboarding: onboardingNeeded };
};

// الدفع الإلكتروني
type DemoIntent = { id: string; purpose: "SUBSCRIPTION" | "INSTALLMENT" | "ADDON"; plan_tier: string | null; billing_cycle: string | null; installment_id: string | null;
  addon_code: string | null; description: string; amount_net: number; vat_amount: number; total: number; status: "INITIATED" | "PAID" | "FAILED" | "EXPIRED";
  created_at: string; paid_at: string | null; invoice_id: string | null; provider: string };
const intents: DemoIntent[] = [];
const intentOut = (i: DemoIntent) => ({ id: i.id, purpose: i.purpose, description: i.description, amount_net: i.amount_net, vat_amount: i.vat_amount,
  total: i.total, status: i.status, created_at: i.created_at, paid_at: i.paid_at, invoice_id: i.invoice_id, provider: i.provider });
function confirmIntent(it: DemoIntent) {
  if (it.status === "PAID") return it;
  const o = orgs.find((x) => x.id === ORG_A)!;
  const ref = `SANDBOX:${it.id.slice(-8)}`;
  let inv: DemoInvoice;
  if (it.purpose === "INSTALLMENT") {
    const plan = plansDemo.find((x) => x.items.some((i) => i.id === it.installment_id))!;
    inv = payInst(plan, plan.items.find((i) => i.id === it.installment_id)!, ref, "دفع إلكتروني");
  } else if (it.purpose === "SUBSCRIPTION") {
    const months = it.billing_cycle === "YEARLY" ? 12 : 1;
    const now = new Date();
    const from = o.sub && o.sub.billing_status !== "TRIAL" && new Date(o.sub.ends_at) > now ? new Date(o.sub.ends_at) : now;
    const ends = new Date(from); ends.setUTCMonth(ends.getUTCMonth() + months);
    o.sub = { id: o.sub?.id ?? uid(), plan_tier: it.plan_tier!, billing_cycle: it.billing_cycle!, billing_status: "ACTIVE",
      starts_at: o.sub?.billing_status === "TRIAL" || !o.sub ? now.toISOString() : o.sub.starts_at, ends_at: ends.toISOString() };
    o.billing.unshift({ event_type: "PAYMENT", plan_tier: it.plan_tier, amount_sar: it.amount_net, period_months: months, reference: ref, note: "دفع إلكتروني",
      created_at: now.toISOString(), actor: "دفع إلكتروني" });
    inv = subscriptionInvoice(o, it.plan_tier!, it.amount_net, months, ref);
  } else {
    const code = it.addon_code ?? "WA_BOT", cur = addonPaidUntil[code];
    const base = cur && cur > new Date().toISOString() ? new Date(cur) : new Date();
    base.setUTCMonth(base.getUTCMonth() + 1); addonPaidUntil[code] = base.toISOString();
    inv = issueInvoice({ source: "SUBSCRIPTION", org: o, ref, lines: [invoiceLine(`${addonCatalog.find((a) => a.code === code)!.name} — اشتراك شهر`, 1, it.amount_net)], cycle: "MONTHLY" });
  }
  Object.assign(it, { status: "PAID", paid_at: new Date().toISOString(), invoice_id: inv.id });
  return it;
}

// الزكاة والضريبة
let taxProfileDemo: TaxProfile | null = { vat_registered: true, vat_frequency: "QUARTERLY", withholding_applies: true, zakat_applies: true, fiscal_year_end_month: 12 };
type DemoTaxTask = { id: string; kind: TaxKind; period_start: string; period_end: string; due_date: string; amount: number | null; done_at: string | null; reference: string | null; done_by_name: string | null };
const taxTasksDemo: DemoTaxTask[] = [];
function ensureTaxTasks() {
  if (!taxProfileDemo) return;
  const today = iso(riyadhToday());
  const first = taxTasksDemo.length === 0;
  for (const t of taxPlan(today, taxProfileDemo)) {
    if (taxTasksDemo.some((x) => x.kind === t.kind && x.period_start === t.start)) continue;
    const done = first && (t.due < today || (t.kind === "WHT_RETURN" && t.end < today));
    taxTasksDemo.push({ id: uid(), kind: t.kind, period_start: t.start, period_end: t.end, due_date: t.due, amount: null,
      done_at: done ? `${addDaysIso(t.due, -3)}T09:00:00.000Z` : null, reference: done ? `ZATCA-${t.end.slice(0, 7).replace("-", "")}` : null, done_by_name: done ? "أحمد العتيبي" : null });
  }
}
function taxOverviewDemo() {
  ensureTaxTasks();
  const today = iso(riyadhToday());
  return { enabled: !!taxProfileDemo, profile: taxProfileDemo, can_manage: true, today,
    tasks: [...taxTasksDemo].sort((a, b) => b.due_date.localeCompare(a.due_date)).map((t) => {
      const left = daysLeft(t.due_date);
      return { ...t, label: TAX_LABEL[t.kind], period_label: taxPeriodLabel(t.kind, t.period_start, t.period_end), days_left: left, overdue: !t.done_at && left < 0 };
    }) };
}

// رابط التقويم
let calFeed: { include_people: boolean; created_at: string } | null = null;

// بوت الموظفين
type DemoBotMember = { id: string; full_name: string; phone: string; status: "INVITED" | "PENDING" | "ACTIVE" | "REMOVED"; joined_via: string; consent_at: string | null;
  created_at: string; employee_id: string | null };
const botSettingsDemo = { enabled: true, invite_code: "nk7q2m", welcome_text: null as string | null, hr_contact: "الموارد البشرية — تحويلة 120", require_approval: true };
const botMembers: DemoBotMember[] = [
  { id: uid(), full_name: "سلطان المطيري", phone: "+966500000021", status: "ACTIVE", joined_via: "INVITE", consent_at: ts(-12), created_at: ts(-13), employee_id: employeesDemo.find((x) => x.full_name === "سلطان المطيري")?.id ?? null },
  { id: uid(), full_name: "نورة الدوسري", phone: "+966500000022", status: "ACTIVE", joined_via: "INVITE", consent_at: ts(-11), created_at: ts(-13), employee_id: employeesDemo.find((x) => x.full_name === "نورة الدوسري")?.id ?? null },
  { id: uid(), full_name: "جون ماثيو", phone: "+966500000023", status: "ACTIVE", joined_via: "CODE", consent_at: ts(-6), created_at: ts(-6), employee_id: employeesDemo.find((x) => x.full_name === "جون ماثيو")?.id ?? null },
  { id: uid(), full_name: "عبدالله الشهري", phone: "+966500000024", status: "INVITED", joined_via: "INVITE", consent_at: null, created_at: ts(-2), employee_id: null },
  { id: uid(), full_name: "علي منصور", phone: "+966500000025", status: "PENDING", joined_via: "CODE", consent_at: ts(-1), created_at: ts(-1), employee_id: null },
];
const botFaqs = [
  { id: uid(), question: "كيف أطلب إجازة؟", answer: "قدّم الطلب من نموذج الإجازات لدى الموارد البشرية قبل أسبوعين على الأقل، ويعتمده مديرك المباشر.", is_active: true },
  { id: uid(), question: "ما ساعات الدوام؟", answer: "من الأحد إلى الخميس، من 8 صباحاً حتى 5 مساءً، وفي رمضان 6 ساعات يومياً.", is_active: true },
  { id: uid(), question: "متى تُصرف الرواتب؟", answer: "تُصرف الرواتب يوم 27 من كل شهر، وإذا صادف إجازة تُصرف في آخر يوم عمل قبله.", is_active: true },
];
const LEAVE_POLICY = { id: uid(), source: null, policy_type: "OTHER", title: "سياسة الإجازات", version: "1.0", approval_date: inDays(-90), review_due_date: inDays(275), status: "ACTIVE",
  body_md: "# الإجازة السنوية\nيستحق الموظف إجازة سنوية مدتها 21 يوماً، وتصبح 30 يوماً بعد خمس سنوات خدمة متصلة.\n\n# الإجازة المرضية\nتُقدَّم الإجازة المرضية بتقرير طبي معتمد من منصة صحتي خلال يومين من الغياب.\n\n# إجازة الزواج والمولود\nللموظف إجازة زواج خمسة أيام، وإجازة ثلاثة أيام عند ولادة مولود له." };
policies.push(LEAVE_POLICY);
const policyShare = new Map<string, { shared: boolean; summary: string | null }>([[LEAVE_POLICY.id, { shared: true, summary: null }]]);
const acksDemo: { policy_id: string; member_id: string; version: string; at: string }[] = [
  { policy_id: LEAVE_POLICY.id, member_id: botMembers[0].id, version: "1.0", at: ts(-10) },
  { policy_id: LEAVE_POLICY.id, member_id: botMembers[1].id, version: "1.0", at: ts(-9) },
];
type DemoBotMsg = { id: number; member_id: string | null; direction: "IN" | "OUT"; body: string; intent: string | null; simulated: boolean; created_at: string };
const botLog: DemoBotMsg[] = [];
let botMsgSeq = 0;
function botStateFor(member: DemoBotMember | null): BotState {
  const shared = policies.filter((x) => x.status === "ACTIVE" && policyShare.get(x.id)?.shared).sort((a, b) => a.title.localeCompare(b.title, "ar"));
  const acc = botAccess();
  const q = (acc.limits as { questions?: number | null }).questions;
  const used = botLog.filter((x) => x.direction === "OUT" && !x.simulated && ["ANSWER", "NO_ANSWER", "SENSITIVE"].includes(x.intent ?? "")).length;
  return { member_status: member ? (member.status === "REMOVED" ? "REMOVED" : member.status) : "ACTIVE", member_name: member ? member.full_name.split(" ")[0] : "تجربة",
    org_name: orgs.find((x) => x.id === ORG_A)!.name, hr_contact: botSettingsDemo.hr_contact, welcome: botSettingsDemo.welcome_text,
    policies: shared.map((x) => ({ id: x.id, title: x.title, version: x.version, body: x.body_md ?? "", summary: policyShare.get(x.id)?.summary ?? null })),
    faqs: botFaqs.filter((f) => f.is_active).map((f) => [f.id, f.question, f.answer] as [string, string, string]),
    acknowledged: new Set(member ? acksDemo.filter((a) => a.member_id === member.id && policies.find((x) => x.id === a.policy_id)?.version === a.version).map((a) => a.policy_id) : []),
    quota_left: q == null ? null : q - used };
}
// محادثات سابقة للعرض
(() => {
  for (const [mi, q, ago] of [[0, "كم مدة الإجازة السنوية؟", -5], [2, "متى تصرف الرواتب", -3], [1, "كم راتب فهد؟", -2], [0, "هل يوجد بدل سفر؟", -1]] as [number, string, number][]) {
    const m = botMembers[mi]; const r = botHandle(q, botStateFor(m));
    botLog.unshift({ id: ++botMsgSeq, member_id: m.id, direction: "IN", body: q, intent: null, simulated: false, created_at: ts(ago) });
    botLog.unshift({ id: ++botMsgSeq, member_id: m.id, direction: "OUT", body: r.text, intent: r.intent, simulated: false, created_at: ts(ago) });
  }
})();
function botOverviewDemo() {
  const access = botAccess();
  const out = { access, can_manage: true, live: false };
  if (!access.via) return out;
  const name = (id: string | null) => botMembers.find((m) => m.id === id)?.full_name ?? null;
  const unanswered: { body: string; created_at: string; full_name: string | null }[] = [];
  botLog.forEach((x, i) => { if (x.intent === "NO_ANSWER" && !x.simulated) { const q = botLog.slice(i + 1).find((y) => y.direction === "IN" && y.member_id === x.member_id); if (q) unanswered.push({ body: q.body, created_at: q.created_at, full_name: name(q.member_id) }); } });
  const active = botMembers.filter((m) => m.status !== "REMOVED");
  return { ...out, settings: { ...botSettingsDemo },
    members: active.map((m) => ({ ...m, acks: acksDemo.filter((a) => a.member_id === m.id).length })),
    policies: policies.filter((x) => x.status === "ACTIVE").map((x) => ({ id: x.id, title: x.title, version: x.version, shared_with_employees: !!policyShare.get(x.id)?.shared,
      employee_summary: policyShare.get(x.id)?.summary ?? null, acks: acksDemo.filter((a) => a.policy_id === x.id && a.version === x.version).length })),
    faqs: botFaqs.map((f) => ({ ...f })), employees: employeesDemo.filter((e) => e.is_active).map((e) => ({ id: e.id, full_name: e.full_name })), log: botLog.slice(0, 60).map((x) => ({ ...x, full_name: name(x.member_id) })), unanswered: unanswered.slice(0, 20),
    stats: { members_active: active.filter((m) => m.status === "ACTIVE").length, members_total: active.length,
      questions_month: botLog.filter((x) => x.direction === "OUT" && !x.simulated && ["ANSWER", "NO_ANSWER", "SENSITIVE"].includes(x.intent ?? "")).length,
      shared_policies: policies.filter((x) => x.status === "ACTIVE" && policyShare.get(x.id)?.shared).length } };
}

function growthRoute(method: string, p: string, body: Record<string, unknown>): unknown {
  let m: RegExpMatchArray | null;
  // الإعداد
  if (p === "/onboarding" && method === "GET") return onboardingState();
  if (p === "/onboarding" && method === "POST") {
    const o = orgs.find((x) => x.id === ORG_A)!;
    o.size = String(body.commercial_size); if (body.industry_type) o.industry = String(body.industry_type);
    if (body.labor_enabled) laborProfileDemo = { ...(laborProfileDemo ?? { nitaqat_band: null, nitaqat_checked_on: null, gosi_employer_no: null }), salary_day: Number(body.salary_day) || 27 };
    taxProfileDemo = { vat_registered: !!body.vat_registered, vat_frequency: body.vat_frequency === "MONTHLY" ? "MONTHLY" : "QUARTERLY",
      withholding_applies: !!body.withholding_applies, zakat_applies: true, fiscal_year_end_month: Number(body.fiscal_year_end_month) || 12 };
    taxTasksDemo.splice(0); onboardingNeeded = false; return { ok: true };
  }
  if (p === "/auth/resend-verification") return { sent: true };
  // الدفع
  if (p === "/billing/checkout/options") {
    const o = orgs.find((x) => x.id === ORG_A)!;
    const plan = plansDemo.find((x) => x.org_id === ORG_A && x.status === "ACTIVE");
    const next = plan?.items.find((i) => !i.paid_at);
    return { ...pricingView(), vat_rate: finProfile.vat_registered ? VAT_RATE : 0, provider: "fake", can_pay: true,
      subscription: o.sub ? { plan_tier: o.sub.plan_tier, billing_cycle: o.sub.billing_cycle, billing_status: o.sub.billing_status, ends_at: o.sub.ends_at } : null,
      next_installment: plan && next ? { id: next.id, seq: next.seq, due_date: next.due_date, amount_net: next.amount_net, installments: plan.installments } : null,
      bot: botAccess(), attendance: addonAccess("ATTENDANCE"),
      addon_access: Object.fromEntries(addonCatalog.map((a) => [a.code, addonAccess(a.code)])), employees: employeesDemo.filter((e) => e.is_active).length,
      hr_tier: tierForDemo(employeesDemo.filter((e) => e.is_active).length)?.code ?? null, promo: promoView(true) };
  }
  if ((m = p.match(/^\/billing\/promo\/([A-Z_]+)\/claim$/)) && method === "POST") {
    if (m[1] !== promoDemo.code) throw new DemoError(404, "العرض غير موجود");
    const st = promoView(true);
    if (!st.eligible || !st.tier_code) throw new DemoError(409, st.reason ?? "غير مؤهل للعرض");
    const until = new Date(); until.setUTCMonth(until.getUTCMonth() + promoDemo.free_months);
    addonPaidUntil[st.tier_code] = until.toISOString(); promoDemo.used++; promoDemo.claimed = true;
    return { addon_code: st.tier_code, addon_name: st.tier_name, paid_until: until.toISOString() };
  }
  if (p === "/billing/checkout" && method === "POST") {
    const o = orgs.find((x) => x.id === ORG_A)!;
    const rate = finProfile.vat_registered ? VAT_RATE : 0;
    let net: number, desc: string; const extra: Partial<DemoIntent> = {};
    if (body.purpose === "SUBSCRIPTION") {
      if (plansDemo.some((x) => x.org_id === ORG_A && x.status === "ACTIVE")) throw new DemoError(409, "لديك خطة أقساط سنوية فعّالة؛ ادفع القسط المستحق بدلاً من ذلك");
      const tier = String(body.plan_tier ?? o.sub?.plan_tier); const cycle = body.billing_cycle === "YEARLY" ? "YEARLY" : "MONTHLY";
      net = PRICES[tier][cycle === "YEARLY" ? 1 : 0]; desc = `اشتراك ${PLAN_AR[tier]} — ${cycle === "YEARLY" ? "سنة" : "شهر"}`;
      Object.assign(extra, { plan_tier: tier, billing_cycle: cycle });
    } else if (body.purpose === "INSTALLMENT") {
      const plan = plansDemo.find((x) => x.org_id === ORG_A && x.status === "ACTIVE");
      const it = plan?.items.find((i) => i.id === body.installment_id);
      if (!plan || !it || it.paid_at) throw new DemoError(409, "القسط غير موجود أو مدفوع");
      net = it.amount_net; desc = `اشتراك سنوي ${PLAN_AR[plan.plan_tier]} — القسط ${it.seq} من ${plan.installments}`;
      Object.assign(extra, { installment_id: it.id, plan_tier: plan.plan_tier, billing_cycle: "YEARLY" });
    } else {
      const ad = addonCatalog.find((a) => a.code === body.addon_code && a.is_active);
      if (!ad) throw new DemoError(404, "الإضافة غير متاحة");
      if (addonAccess(ad.code).via === "PLAN") throw new DemoError(409, "هذه الإضافة مشمولة في باقتك مجاناً");
      net = ad.monthly_price; desc = `${ad.name} — اشتراك شهر`; extra.addon_code = ad.code;
    }
    const vat = round2(net * rate);
    const it: DemoIntent = { id: uid(), purpose: body.purpose as DemoIntent["purpose"], plan_tier: null, billing_cycle: null, installment_id: null, addon_code: null,
      ...extra, description: desc, amount_net: net, vat_amount: vat, total: round2(net + vat), status: "INITIATED", created_at: new Date().toISOString(),
      paid_at: null, invoice_id: null, provider: "FAKE" };
    intents.unshift(it);
    return { intent_id: it.id, checkout_url: `/billing/pay/?intent=${it.id}&sandbox=1`, total: it.total };
  }
  if ((m = p.match(/^\/billing\/checkout\/([^/]+)(\/sandbox-pay)?$/))) {
    const it = intents.find((x) => x.id === m![1]); if (!it) throw new DemoError(404, "عملية الدفع غير موجودة");
    return intentOut(m[2] ? confirmIntent(it) : it);
  }
  if (p === "/billing/payments") return intents.map(intentOut);
  // الضريبة
  if (p === "/tax/overview") return taxOverviewDemo();
  if (p === "/tax/profile" && method === "PUT") {
    taxProfileDemo = { vat_registered: !!body.vat_registered, vat_frequency: body.vat_frequency === "MONTHLY" ? "MONTHLY" : "QUARTERLY",
      withholding_applies: !!body.withholding_applies, zakat_applies: body.zakat_applies !== false, fiscal_year_end_month: Number(body.fiscal_year_end_month) || 12 };
    for (let i = taxTasksDemo.length - 1; i >= 0; i--) if (!taxTasksDemo[i].done_at) taxTasksDemo.splice(i, 1);
    ensureTaxTasks(); return { ok: true };
  }
  if ((m = p.match(/^\/tax\/tasks\/([^/]+)\/(done|reopen)$/))) {
    const t = taxTasksDemo.find((x) => x.id === m![1]); if (!t) throw new DemoError(404, "الإقرار غير موجود");
    if (m[2] === "done") { if (t.done_at) throw new DemoError(409, "الإقرار مؤكَّد مسبقاً"); Object.assign(t, { done_at: new Date().toISOString(), reference: (body.reference as string) || null, done_by_name: "أحمد العتيبي" }); if (body.amount != null && body.amount !== "") t.amount = Number(body.amount); }
    else { if (!t.done_at) throw new DemoError(409, "الإقرار غير مؤكَّد"); Object.assign(t, { done_at: null, done_by_name: null }); }
    return { ok: true };
  }
  // التقويم
  if (p === "/calendar/feed" && method === "GET") return { active: !!calFeed, ...(calFeed ?? {}), can_manage: true };
  if (p === "/calendar/feed" && method === "POST") {
    calFeed = { include_people: !!body.include_people, created_at: new Date().toISOString() };
    const al = alertsOverview() as { upcoming: { target_type: string; target_id: string; title: string; due_date: string }[] };
    const seen = new Set<string>();
    const events = al.upcoming.filter((u) => { const k = `${u.target_type}${u.target_id}`; if (seen.has(k)) return false; seen.add(k); return true; });
    return { url: `https://app.haseef.sa/api/v1/public/calendar/${uid().slice(-12)}${uid().slice(-12)}.ics`, include_people: calFeed.include_people,
      ics: buildIcs(orgs.find((x) => x.id === ORG_A)!.name, events, calFeed.include_people) };
  }
  if (p === "/calendar/feed" && method === "DELETE") { calFeed = null; return undefined; }
  // البوت
  if (p === "/bot/overview") return botOverviewDemo();
  if (p.startsWith("/bot/") && !botAccess().via) throw new DemoError(402, "بوت الموظفين غير مفعّل. اشترك فيه من صفحة «بوت الموظفين».");
  if (p === "/bot/settings") { Object.assign(botSettingsDemo, { enabled: !!body.enabled, welcome_text: (body.welcome_text as string) || null, hr_contact: (body.hr_contact as string) || null, require_approval: !!body.require_approval }); return { ok: true }; }
  if (p === "/bot/invite-code/rotate") { botSettingsDemo.invite_code = uid().slice(-6); return { invite_code: botSettingsDemo.invite_code }; }
  if (p === "/bot/members" && method === "POST") {
    const phone = String(body.phone ?? "");
    if (!/^\+9665\d{8}$/.test(phone)) throw new DemoError(422, "رقم الجوال بصيغة ‎+9665XXXXXXXX");
    if (String(body.full_name ?? "").trim().length < 2) throw new DemoError(422, "اكتب اسم الموظف");
    if (botMembers.some((x) => x.phone === phone && x.status !== "REMOVED")) throw new DemoError(409, "هذا الرقم مضاف مسبقاً");
    const lim = (botAccess().limits as { members?: number | null }).members;
    if (lim != null && botMembers.filter((x) => x.status !== "REMOVED").length >= lim) throw new DemoError(409, `بلغت الحد (${lim} موظفاً) في اشتراكك الحالي`);
    const x: DemoBotMember = { id: uid(), full_name: String(body.full_name), phone, status: "INVITED", joined_via: "INVITE", consent_at: null, created_at: new Date().toISOString(), employee_id: (body.employee_id as string) ?? null };
    botMembers.push(x); return { id: x.id };
  }
  if ((m = p.match(/^\/bot\/members\/([^/]+)$/)) && method === "PATCH") {
    const x = botMembers.find((y) => y.id === m![1] && y.status !== "REMOVED"); if (!x) throw new DemoError(404, "العضو غير موجود");
    x.employee_id = (body.employee_id as string) || null; return { ok: true };
  }
  if ((m = p.match(/^\/bot\/members\/([^/]+)(\/approve)?$/))) {
    const x = botMembers.find((y) => y.id === m![1]); if (!x) throw new DemoError(404, "الموظف غير موجود");
    if (m[2]) { if (x.status !== "PENDING") throw new DemoError(409, "لا يوجد طلب انضمام بانتظار الموافقة"); x.status = "ACTIVE"; x.consent_at ??= new Date().toISOString(); return { ok: true }; }
    x.status = "REMOVED"; return undefined;
  }
  if (p === "/bot/faqs" && method === "POST") {
    if (String(body.question ?? "").trim().length < 3 || String(body.answer ?? "").trim().length < 2) throw new DemoError(422, "اكتب السؤال والإجابة");
    const f = { id: uid(), question: String(body.question), answer: String(body.answer), is_active: body.is_active !== false }; botFaqs.push(f); return { id: f.id };
  }
  if ((m = p.match(/^\/bot\/faqs\/([^/]+)$/))) {
    const k = botFaqs.findIndex((f) => f.id === m![1]); if (k < 0) throw new DemoError(404, "السؤال غير موجود");
    if (method === "DELETE") { botFaqs.splice(k, 1); return undefined; }
    Object.assign(botFaqs[k], { question: String(body.question), answer: String(body.answer), is_active: !!body.is_active }); return { ok: true };
  }
  if ((m = p.match(/^\/bot\/policies\/([^/]+)$/))) {
    if (!policies.some((x) => x.id === m![1] && x.status === "ACTIVE")) throw new DemoError(404, "السياسة غير موجودة أو غير معتمدة");
    policyShare.set(m[1], { shared: !!body.shared, summary: (body.employee_summary as string) || null }); return { ok: true };
  }
  if (p === "/bot/simulate") {
    const member = body.member_id ? botMembers.find((x) => x.id === body.member_id) ?? null : null;
    const r = botHandle(String(body.text ?? ""), botStateFor(member));
    if (r.action?.attend) {
      if (!member) r.text = "في التجربة بصفة المدير لا يوجد سجل موظف. اختر موظفاً مربوطاً لتجربة رابط الحضور.";
      else if (!addonAccess("ATTENDANCE").via) r.text = "خدمة تسجيل الحضور غير مفعّلة لمنشأتك.";
      else if (!member.employee_id) r.text = "رقمك غير مربوط بسجلك الوظيفي. اطلب من الموارد البشرية ربطه من صفحة بوت الموظفين.";
      else { attLinks.add(member.employee_id); r.text = `رابط تسجيل الحضور والانصراف الخاص بك (لا تشاركه):\n${attLinkUrl(member.employee_id)}\nسيطلب منك الموقع وبصمة جوالك.`; }
    }
    if (r.action?.hr) r.text = hrBotReply(member, String(r.action.hr));
    if (member && r.action) {
      if (r.action.consent) Object.assign(member, { status: "ACTIVE", consent_at: new Date().toISOString() });
      if (r.action.opt_out) member.status = "REMOVED";
      if (r.action.ack) acksDemo.push({ policy_id: String(r.action.ack), member_id: member.id, version: String(r.action.version), at: new Date().toISOString() });
    }
    botLog.unshift({ id: ++botMsgSeq, member_id: member?.id ?? null, direction: "IN", body: String(body.text ?? ""), intent: null, simulated: true, created_at: new Date().toISOString() });
    botLog.unshift({ id: ++botMsgSeq, member_id: member?.id ?? null, direction: "OUT", body: r.text, intent: r.intent, simulated: true, created_at: new Date().toISOString() });
    return { reply: r.text, intent: r.intent, sources: r.sources };
  }
  if (p === "/bot/acknowledgments") {
    const shared = policies.filter((x) => x.status === "ACTIVE" && policyShare.get(x.id)?.shared);
    return shared.flatMap((x) => botMembers.filter((y) => y.status === "ACTIVE").map((y) => ({ policy_id: x.id, title: x.title, version: x.version, member_id: y.id, full_name: y.full_name,
      acknowledged_at: acksDemo.find((a) => a.policy_id === x.id && a.member_id === y.id && a.version === x.version)?.at ?? null })));
  }
  return NO_ROUTE;
}
const NO_ROUTE = Symbol("no-route");

// ---------- الحضور بالموقع وبصمة الجوال (نسخة العرض) ----------
const attSettings: AttendanceSettings = { work_start: "08:00", work_end: "17:00", grace_minutes: 15, work_days: [0, 1, 2, 3, 4], require_device: true, retention_days: 90 };
const attSites: (SiteInput & { id: string })[] = [{ id: uid(), name: "المقر الرئيسي — الرياض", lat: 24.7136, lng: 46.6753, radius_m: 100, max_accuracy_m: 100, is_active: true }];
const attLinks = new Set<string>();
const attDevices = new Map<string, { label: string | null; created_at: string; last_used_at: string | null; credential_id?: string }>();
type DemoAtt = { id: number; employee_id: string; kind: "IN" | "OUT"; at: string; status: "ACCEPTED" | "REJECTED"; reason: string | null; distance_m: number | null;
  accuracy_m: number | null; late_minutes: number | null; flags: string[]; site_id: string | null; lat: number | null; lng: number | null };
const attRecords: DemoAtt[] = [];
let attSeq = 0;
const riyadhNow = () => new Date(Date.now() + 3 * 3600e3);                 // ساعة الرياض ممثلة كـ UTC
const riyadhIso = (d: Date) => d.toISOString().slice(0, 16);
const toUtc = (localIso: string) => new Date(new Date(`${localIso}:00Z`).getTime() - 3 * 3600e3).toISOString();
(() => {
  const emps = employeesDemo.filter((e) => e.is_active).slice(0, 8);
  emps.forEach((e, i) => { attLinks.add(e.id); if (i < 6) attDevices.set(e.id, { label: i % 2 ? "iPhone" : "Android", created_at: ts(-20), last_used_at: ts(-1) }); });
  const today = riyadhNow();
  for (let back = 13; back >= 0; back--) {
    const d = new Date(today.getTime() - back * 864e5); const day = d.getUTCDay();
    if (!attSettings.work_days.includes(day)) continue;
    const date = d.toISOString().slice(0, 10);
    emps.slice(0, 6).forEach((e, i) => {
      if ((i + back) % 9 === 4) return;                                     // غياب متفرق
      const inMin = 7 * 60 + 45 + ((i * 7 + back * 3) % 45);                // 7:45 – 8:30
      const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      const late = Math.max(0, inMin - (8 * 60 + attSettings.grace_minutes));
      if (back === 0 && today.getUTCHours() * 60 + today.getUTCMinutes() < inMin) return;
      attRecords.push({ id: ++attSeq, employee_id: e.id, kind: "IN", at: toUtc(`${date}T${hhmm(inMin)}`), status: "ACCEPTED", reason: null, distance_m: 12 + ((i * 13) % 60),
        accuracy_m: 8 + (i % 4) * 6, late_minutes: late, flags: [], site_id: attSites[0].id, lat: 24.7137, lng: 46.6754 });
      if (back > 0) attRecords.push({ id: ++attSeq, employee_id: e.id, kind: "OUT", at: toUtc(`${date}T${hhmm(17 * 60 + ((i * 11) % 40))}`), status: "ACCEPTED", reason: null,
        distance_m: 20 + i, accuracy_m: 10, late_minutes: null, flags: [], site_id: attSites[0].id, lat: 24.7137, lng: 46.6754 });
    });
    if (back === 2) attRecords.push({ id: ++attSeq, employee_id: emps[6].id, kind: "IN", at: toUtc(`${date}T08:05`), status: "REJECTED", reason: "OUTSIDE", distance_m: 2380,
      accuracy_m: 15, late_minutes: null, flags: [], site_id: attSites[0].id, lat: 24.735, lng: 46.68 });
  }
})();
const attLinkUrl = (id: string) => {
  const base = typeof location !== "undefined" ? location.origin + location.pathname.split("/").slice(0, 2).join("/") : "https://app.haseef.sa";
  return `${base.replace(/\/admin$/, "")}/attend/?t=demo-${id}`;
};
function attRecordView(r: DemoAtt) {
  return { id: r.id, kind: r.kind, at: r.at, status: r.status, reason: r.reason, reason_label: r.reason ? ATT_REASON[r.reason] ?? r.reason : null,
    distance_m: r.distance_m, accuracy_m: r.accuracy_m, late_minutes: r.late_minutes, flags: r.flags, flag_labels: r.flags.map((f) => ATT_FLAG[f] ?? f),
    full_name: employeesDemo.find((e) => e.id === r.employee_id)?.full_name ?? "—", site_name: attSites.find((s) => s.id === r.site_id)?.name ?? null };
}
function attOverviewDemo() {
  const access = addonAccess("ATTENDANCE");
  if (!access.via) return { access, can_manage: true };
  const dayStart = toUtc(`${riyadhIso(riyadhNow()).slice(0, 10)}T00:00`);
  const people = employeesDemo.filter((e) => e.is_active).map((e) => {
    const mine = attRecords.filter((r) => r.employee_id === e.id && r.status === "ACCEPTED" && r.at >= dayStart);
    const ins = mine.filter((r) => r.kind === "IN"), outs = mine.filter((r) => r.kind === "OUT");
    const dev = attDevices.get(e.id);
    return { employee_id: e.id, full_name: e.full_name, job_title: e.job_title, has_link: attLinks.has(e.id), device_since: dev?.created_at ?? null,
      device_label: dev?.label ?? null, last_used_at: dev?.last_used_at ?? null, in_at: ins[0]?.at ?? null, out_at: outs.at(-1)?.at ?? null,
      late_minutes: ins[0]?.late_minutes ?? null };
  });
  return { access, can_manage: true, settings: { ...attSettings }, sites: attSites.map((x) => ({ ...x })), people,
    recent: [...attRecords].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100).map(attRecordView),
    limit: (access.limits as { members?: number | null }).members ?? null, linked: attLinks.size };
}
function attPerson(token: string) {
  const id = token.replace(/^demo-/, ""); const e = employeesDemo.find((x) => x.id === id && x.is_active);
  if (e) attLinks.add(e.id);   // نسخة العرض: كل تبويب يبدأ ببيانات جديدة، فيُقبل رابط أي موظف فعّال
  if (!e) throw new DemoError(404, "الرابط غير صالح أو أُلغي. اطلب رابطاً جديداً من الموارد البشرية أو من مساعد واتساب.");
  if (!addonAccess("ATTENDANCE").via) throw new DemoError(403, "خدمة الحضور غير مفعّلة لمنشأتك حالياً.");
  return e;
}
function attendancePublicRoute(method: string, p: string, body: Record<string, unknown>): unknown {
  const m = p.match(/^\/public\/attendance\/([^/]+)(\/enroll|\/check)?$/);
  if (!m) return NO_ROUTE;
  const e = attPerson(decodeURIComponent(m[1]));
  const dayStart = toUtc(`${riyadhIso(riyadhNow()).slice(0, 10)}T00:00`);
  if (!m[2]) {
    const dev = attDevices.get(e.id);
    return { employee_name: e.full_name, org_name: orgs.find((o) => o.id === ORG_A)!.name, has_device: !!dev, require_device: attSettings.require_device,
      sites: attSites.filter((x) => x.is_active).map((x) => x.name),
      today: attRecords.filter((r) => r.employee_id === e.id && r.at >= dayStart).map((r) => ({ kind: r.kind, at: r.at, status: r.status, reason: r.reason,
        reason_label: r.reason ? ATT_REASON[r.reason] : null, late_minutes: r.late_minutes })),
      webauthn: { rp_id: typeof location !== "undefined" ? location.hostname : "localhost", rp_name: "حصيف", challenge: uid(), purpose: dev ? "CHECK" : "ENROLL",
        user_id: e.id, credential_id: dev ? dev.credential_id ?? "demo-credential" : null } };
  }
  if (m[2] === "/enroll") {
    if (attDevices.has(e.id)) throw new DemoError(409, "لديك جهاز مربوط. لتغييره اطلب من الموارد البشرية إلغاء الربط.");
    if (!body.client_data_json) throw new DemoError(400, "تعذّر ربط الجهاز");
    attDevices.set(e.id, { label: (body.label as string) || "جوال", created_at: new Date().toISOString(), last_used_at: null, credential_id: (body.credential_id as string) || undefined });
    return { enrolled: true };
  }
  // نسخة العرض: يُطلب توقيع البصمة من المتصفح فعلاً، لكن التحقق التشفيري يتم في الخادم الحقيقي فقط
  const dev = attDevices.get(e.id);
  const now = riyadhNow(); const nowLocal = riyadhIso(now);
  let res: AttResult;
  if (attSettings.require_device && (!dev || !body.signature)) res = { status: "REJECTED", reason: dev ? "BAD_DEVICE" : "NO_DEVICE", site_id: null, distance_m: null, flags: [], late_minutes: null };
  else {
    const last = [...attRecords].filter((r) => r.employee_id === e.id && r.status === "ACCEPTED").sort((a, b) => b.at.localeCompare(a.at))[0];
    res = evaluateAttendance({ lat: Number(body.lat), lng: Number(body.lng), accuracy: Number(body.accuracy), sites: attSites, kind: body.kind === "OUT" ? "OUT" : "IN",
      nowLocal, weekday: now.getUTCDay(), workStart: attSettings.work_start, graceMinutes: attSettings.grace_minutes, workDays: attSettings.work_days,
      last: last && last.lat != null ? { atLocal: riyadhIso(new Date(new Date(last.at).getTime() + 3 * 3600e3)), lat: last.lat, lng: last.lng } : null });
    if (dev) dev.last_used_at = new Date().toISOString();
  }
  attRecords.push({ id: ++attSeq, employee_id: e.id, kind: body.kind === "OUT" ? "OUT" : "IN", at: new Date().toISOString(), status: res.status, reason: res.reason,
    distance_m: res.distance_m, accuracy_m: Math.round(Number(body.accuracy)), late_minutes: res.late_minutes, flags: res.flags, site_id: res.site_id,
    lat: Number(body.lat), lng: Number(body.lng) });
  return { status: res.status, reason: res.reason, reason_label: res.reason ? ATT_REASON[res.reason] : null, distance_m: res.distance_m,
    site_name: attSites.find((x) => x.id === res.site_id)?.name ?? null, late_minutes: res.late_minutes, at: new Date().toISOString(), kind: body.kind };
}
function attendanceRoute(method: string, p: string, q: URLSearchParams, body: Record<string, unknown>): unknown {
  let m: RegExpMatchArray | null;
  if (p === "/attendance/overview") return attOverviewDemo();
  if (!p.startsWith("/attendance/")) return NO_ROUTE;
  if (!addonAccess("ATTENDANCE").via) throw new DemoError(402, "خدمة الحضور غير مفعّلة. اشترك فيها من «الاشتراك والدفعات».");
  if (p === "/attendance/settings") {
    const days = ((body.work_days as number[]) ?? []).filter((d) => d >= 0 && d <= 6);
    Object.assign(attSettings, { work_start: String(body.work_start ?? "08:00").slice(0, 5), work_end: String(body.work_end ?? "17:00").slice(0, 5),
      grace_minutes: Number(body.grace_minutes) || 0, work_days: [...new Set(days)].sort(), require_device: body.require_device !== false,
      retention_days: Number(body.retention_days) || 90 });
    return { ok: true };
  }
  const site = (b: Record<string, unknown>): SiteInput => {
    const r = Number(b.radius_m), lat = Number(b.lat), lng = Number(b.lng);
    if (String(b.name ?? "").trim().length < 2) throw new DemoError(422, "اكتب اسم الموقع");
    if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) throw new DemoError(422, "إحداثيات غير صحيحة");
    if (!(r >= 20 && r <= 2000)) throw new DemoError(422, "نصف القطر بين 20 و2000 متر");
    return { name: String(b.name), lat, lng, radius_m: r, max_accuracy_m: Number(b.max_accuracy_m) || 100, is_active: b.is_active !== false };
  };
  if (p === "/attendance/sites" && method === "POST") { const x = { id: uid(), ...site(body) }; attSites.push(x); return { id: x.id }; }
  if ((m = p.match(/^\/attendance\/sites\/([^/]+)$/))) {
    const x = attSites.find((y) => y.id === m![1]); if (!x) throw new DemoError(404, "الموقع غير موجود");
    if (method === "DELETE") { x.is_active = false; return undefined; }
    Object.assign(x, site(body)); return { ok: true };
  }
  if ((m = p.match(/^\/attendance\/people\/([^/]+)\/(link|device)$/))) {
    const e = employeesDemo.find((x) => x.id === m![1] && x.is_active); if (!e) throw new DemoError(404, "الموظف غير موجود");
    if (m[2] === "device") { attDevices.delete(e.id); return undefined; }
    const lim = (addonAccess("ATTENDANCE").limits as { members?: number | null }).members;
    if (lim != null && !attLinks.has(e.id) && attLinks.size >= lim) throw new DemoError(409, `بلغت الحد (${lim} موظفاً) في اشتراك الحضور`);
    attLinks.add(e.id); return { url: attLinkUrl(e.id) };
  }
  if (p === "/attendance/report") {
    const month = q.get("month") ?? riyadhIso(riyadhNow()).slice(0, 7);
    const [y, mo] = month.split("-").map(Number);
    const todayIso = riyadhIso(riyadhNow()).slice(0, 10);
    let workdays = 0; const wdList: string[] = [];
    for (let d = 1; d <= new Date(Date.UTC(y, mo, 0)).getUTCDate(); d++) {
      const iso = `${month}-${String(d).padStart(2, "0")}`;
      if (iso > todayIso) break;
      if (attSettings.work_days.includes(new Date(`${iso}T00:00:00Z`).getUTCDay()) && !hrHolidays().has(iso)) { workdays++; wdList.push(iso); }
    }
    const leaveDaysOf = (id: string) => wdList.filter((d) => leavesDemo.some((l) => l.employee_id === id && l.status === "APPROVED" && l.start_date <= d && d <= l.end_date)).length;
    const inMonth = (r: DemoAtt) => riyadhIso(new Date(new Date(r.at).getTime() + 3 * 3600e3)).slice(0, 7) === month;
    return { month, workdays, rows: employeesDemo.filter((e) => e.is_active).map((e) => {
      const rs = attRecords.filter((r) => r.employee_id === e.id && inMonth(r));
      const ins = rs.filter((r) => r.kind === "IN" && r.status === "ACCEPTED");
      const days = new Set(ins.map((r) => riyadhIso(new Date(new Date(r.at).getTime() + 3 * 3600e3)).slice(0, 10))).size;
      return { id: e.id, full_name: e.full_name, days_present: days, late_days: ins.filter((r) => (r.late_minutes ?? 0) > 0).length,
        late_minutes: ins.reduce((a, r) => a + (r.late_minutes ?? 0), 0), rejected: rs.filter((r) => r.status === "REJECTED").length,
        flagged: rs.filter((r) => r.status === "ACCEPTED" && r.flags.length).length, leave_days: leaveDaysOf(e.id),
        absent_days: Math.max(workdays - days - leaveDaysOf(e.id), 0) };
    }).sort((a, b) => a.full_name.localeCompare(b.full_name, "ar")) };
  }
  return NO_ROUTE;
}

// ---------- الموارد البشرية: الإجازات والمباشرة والخصومات + تقويم المناسبات (نسخة العرض) ----------
type DemoLeave = { id: string; employee_id: string; leave_type: LeaveType; start_date: string; end_date: string; days: number; reason: string | null;
  medical_ref: string | null; status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"; source: "LINK" | "BOT" | "HR"; decision_note: string | null;
  decided_at: string | null; return_date: string | null; return_submitted_at: string | null; return_confirmed_at: string | null; created_at: string;
  attachment?: { name: string; mime: string; b64: string } | null; is_paid: boolean };
type DemoNotice = { id: string; employee_id: string; kind: DeductionKind; incident_date: string; description: string; amount: number; payroll_month: string;
  status: "ISSUED" | "OBJECTED" | "CONFIRMED" | "CANCELLED"; seen_at: string | null; objection_text: string | null; objected_at: string | null;
  decision_note: string | null; decided_at: string | null; created_at: string; leave_request_id: string | null };
const hrSettingsDemo = { count_workdays_only: true, objection_days: 15, notify_employees: true };
const hrPoliciesDemo: Record<LeaveType, LeavePolicy & { is_active: boolean }> = Object.fromEntries(
  LEAVE_TYPES.map((t) => [t, { ...DEFAULT_POLICIES[t], is_active: true }])) as Record<LeaveType, LeavePolicy & { is_active: boolean }>;
const leavesDemo: DemoLeave[] = [];
const leaveAdj: { employee_id: string; year: number; days: number; note: string }[] = [];
const noticesDemo: DemoNotice[] = [];
const eventsDemo: AnnualEvent[] = ([
  ["RAMADAN", "بداية شهر رمضان", "2027-02-08", "RELIGIOUS", false, 0, "مبارك عليكم الشهر، تقبّل الله صيامكم وقيامكم."],
  ["FOUNDING_DAY", "يوم التأسيس", "2027-02-22", "NATIONAL", true, 1, "يوم التأسيس.. ثلاثة قرون من المجد والعز. كل عام والوطن بخير."],
  ["EID_FITR", "عيد الفطر", "2027-03-09", "RELIGIOUS", true, 4, "عيدكم مبارك، وكل عام وأنتم بخير."],
  ["FLAG_DAY", "يوم العلم", "2027-03-11", "NATIONAL", false, 0, "يوم العلم.. راية التوحيد عالية خفّاقة."],
  ["ARAFAH", "يوم عرفة", "2027-05-15", "RELIGIOUS", false, 0, "يوم عرفة.. تقبّل الله منا ومنكم صالح الأعمال."],
  ["EID_ADHA", "عيد الأضحى", "2027-05-16", "RELIGIOUS", true, 4, "عيد أضحى مبارك، أعاده الله علينا وعليكم بالخير."],
  ["HIJRI_NEW_YEAR", "رأس السنة الهجرية 1449", "2027-06-06", "OCCASION", false, 0, "كل عام هجري وأنتم بخير."],
  ["NATIONAL_DAY", "اليوم الوطني السعودي", "2027-09-23", "NATIONAL", true, 1, "اليوم الوطني السعودي.. دام عزك يا وطن."],
  ["RAMADAN", "بداية شهر رمضان", "2028-01-28", "RELIGIOUS", false, 0, "مبارك عليكم الشهر، تقبّل الله صيامكم وقيامكم."],
  ["FOUNDING_DAY", "يوم التأسيس", "2028-02-22", "NATIONAL", true, 1, "يوم التأسيس.. ثلاثة قرون من المجد والعز. كل عام والوطن بخير."],
  ["EID_FITR", "عيد الفطر", "2028-02-26", "RELIGIOUS", true, 4, "عيدكم مبارك، وكل عام وأنتم بخير."],
  ["EID_ADHA", "عيد الأضحى", "2028-05-05", "RELIGIOUS", true, 4, "عيد أضحى مبارك، أعاده الله علينا وعليكم بالخير."],
  ["NATIONAL_DAY", "اليوم الوطني السعودي", "2028-09-23", "NATIONAL", true, 1, "اليوم الوطني السعودي.. دام عزك يا وطن."],
] as const).map(([code, name, event_date, kind, is_holiday, holiday_days, greeting]) => ({ id: uid(), code, name, event_date, kind, is_holiday, holiday_days,
  greeting, notify_subscribers: true, is_active: true, sent_subscribers: 0, sent_employees: 0 }));
const orgEventsDemo = { enabled: false, signature: null as string | null, excluded_codes: [] as string[] };
const hrToday = () => riyadhIso(riyadhNow()).slice(0, 10);
const hrHolidays = () => holidayDates(eventsDemo);
const hrEmp = (id: string) => { const e = employeesDemo.find((x) => x.id === id && x.is_active); if (!e) throw new DemoError(404, "الموظف غير موجود"); return e; };
const hrDaysOf = (t: LeaveType, s: string, e: string) => countLeaveDays(s, e, { workDays: attSettings.work_days, holidays: hrHolidays(), workdaysOnly: hrSettingsDemo.count_workdays_only && t !== "SICK" });
const usedOf = (emp: string, year: number, types: LeaveType[], paidOnly = false) => leavesDemo.filter((l) => l.employee_id === emp && ["PENDING", "APPROVED"].includes(l.status)
  && types.includes(l.leave_type) && l.start_date.startsWith(String(year)) && (!paidOnly || l.is_paid)).reduce((a, l) => a + l.days, 0);
function balanceOf(empId: string, year: number) {
  const e = hrEmp(empId);
  const ent = annualEntitlement(e.start_date, `${year}-12-31`);
  const adj = leaveAdj.filter((a) => a.employee_id === empId && a.year === year).reduce((x, a) => x + a.days, 0);
  const used = usedOf(empId, year, LEAVE_TYPES.filter((t) => hrPoliciesDemo[t].from_balance), true);
  return { year, entitlement: ent, adjustments: adj, used, balance: Math.round((ent + adj - used) * 10) / 10 };
}
/** المرفق في نسخة العرض: يُتحقق من نوعه من أول بايتات الملف كما في الخادم. */
function demoAttachment(a: unknown): DemoLeave["attachment"] {
  if (!a || typeof a !== "object") return null;
  const { file_name, file_base64 } = a as { file_name?: string; file_base64?: string };
  let head = "";
  try { head = atob(String(file_base64 ?? "").slice(0, 16)); } catch { throw new DemoError(422, "تعذّرت قراءة المرفق"); }
  const mime = head.startsWith("%PDF-") ? "application/pdf" : head.startsWith("\xff\xd8\xff") ? "image/jpeg" : head.startsWith("\x89PNG") ? "image/png" : null;
  if (!mime) throw new DemoError(422, "المرفق يجب أن يكون صورة (JPG/PNG) أو PDF");
  if (String(file_base64).length > 8_500_000) throw new DemoError(413, "حجم المرفق يتجاوز 6 ميجابايت");
  return { name: String(file_name || "مرفق"), mime, b64: String(file_base64) };
}
// تقرير طبي تجريبي (PDF صغير) للبيانات المزروعة
const DEMO_REPORT_B64 = btoa("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
  + "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 420 220]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n"
  + "4 0 obj<</Length 98>>stream\nBT /F1 16 Tf 30 160 Td (Medical leave report - DEMO) Tj 0 -30 Td /F1 11 Tf (Sample attachment for Haseef demo only.) Tj ET\nendstream endobj\n"
  + "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
const body_paid = (b: Record<string, unknown>) => (typeof b.is_paid === "boolean" ? b.is_paid : null);
function createLeaveDemo(empId: string, b: Record<string, unknown>, source: DemoLeave["source"], byHr: boolean, approve: boolean) {
  const t = String(b.leave_type) as LeaveType;
  if (!LEAVE_TYPES.includes(t)) throw new DemoError(422, "نوع الإجازة غير معروف");
  const s = String(b.start_date ?? ""), en = String(b.end_date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(en)) throw new DemoError(422, "حدد تاريخ البداية والنهاية");
  const days = hrDaysOf(t, s, en);
  const paid = resolvePaid(hrPoliciesDemo[t], body_paid(b));
  const err = validateLeave({ leaveType: t, isPaid: paid, start: s, end: en, days, today: hrToday(), policy: hrPoliciesDemo[t], byHr,
    balance: balanceOf(empId, Number(s.slice(0, 4))).balance, usedThisYearType: usedOf(empId, Number(s.slice(0, 4)), [t]) });
  if (err) throw new DemoError(422, err);
  const ref = String(b.medical_ref ?? "").trim();
  const att = demoAttachment(b.attachment);
  if (t === "SICK" && !byHr && !att) throw new DemoError(422, "أرفق التقرير الطبي (صورة أو PDF) للإجازة المرضية");
  if (leavesDemo.some((l) => l.employee_id === empId && ["PENDING", "APPROVED"].includes(l.status) && l.start_date <= en && l.end_date >= s))
    throw new DemoError(409, "يوجد طلب إجازة آخر يتداخل مع هذه الفترة");
  const l: DemoLeave = { id: uid(), employee_id: empId, leave_type: t, start_date: s, end_date: en, days, reason: (b.reason as string) || null, medical_ref: ref || null,
    status: approve ? "APPROVED" : "PENDING", source, decision_note: null, decided_at: approve ? new Date().toISOString() : null, return_date: null,
    return_submitted_at: null, return_confirmed_at: null, created_at: new Date().toISOString(), attachment: att, is_paid: paid };
  leavesDemo.push(l);
  return { id: l.id, days, status: l.status, is_paid: paid, has_attachment: !!att, ...(t === "SICK" ? { pay_note: sickNote(usedOf(empId, Number(s.slice(0, 4)), ["SICK"]) - days, days) } : {}) };
}
function annotateSickDemo<T extends { leave_type: LeaveType; status: string; start_date: string; days: number; employee_id?: string; pay_note?: string }>(rows: T[]) {
  const used = new Map<string, number>();
  for (const l of [...rows].sort((a, b) => a.start_date.localeCompare(b.start_date))) {
    if (l.leave_type !== "SICK" || !["PENDING", "APPROVED"].includes(l.status)) continue;
    const k = `${l.employee_id ?? ""}|${l.start_date.slice(0, 4)}`;
    l.pay_note = sickNote(used.get(k) ?? 0, l.days); used.set(k, (used.get(k) ?? 0) + l.days);
  }
  return rows;
}
const leavePublic = ({ attachment, ...l }: DemoLeave) => ({ ...l, has_attachment: !!attachment, attachment_name: attachment?.name ?? null });
function leaveRowDemo(src: DemoLeave) {
  const today = hrToday();
  const l = leavePublic(src);
  const ended = l.status === "APPROVED" && l.end_date < today;
  return { ...l, full_name: employeesDemo.find((e) => e.id === l.employee_id)?.full_name ?? "—", label: LEAVE_LABEL[l.leave_type],
    on_leave_now: l.status === "APPROVED" && l.start_date <= today && today <= l.end_date, awaiting_return: ended && !l.return_confirmed_at,
    late_return_days: ended ? lateReturnDays(l.end_date, l.return_date ?? today, attSettings.work_days, hrHolidays()) : 0 } as LeaveRow;
}
function workMinutes() { const [a, b] = [attSettings.work_start, attSettings.work_end].map((x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5))); return Math.max(b - a, 60); }
const monthOf = (iso: string) => `${iso.slice(0, 7)}-01`;
function monthSums(empId: string, month: string) {
  const live = noticesDemo.filter((n) => n.employee_id === empId && n.payroll_month === month && ["ISSUED", "OBJECTED", "CONFIRMED"].includes(n.status));
  return { fines: live.filter((n) => FINE_KINDS.includes(n.kind)).reduce((a, n) => a + n.amount, 0), total: live.reduce((a, n) => a + n.amount, 0) };
}
function createNoticeDemo(b: Record<string, unknown>) {
  const e = hrEmp(String(b.employee_id));
  const kind = String(b.kind) as DeductionKind;
  if (!KIND_LABEL[kind]) throw new DemoError(422, "نوع الخصم غير معروف");
  const month = `${String(b.payroll_month ?? "")}-01`;
  if (!/^\d{4}-\d{2}-01$/.test(month)) throw new DemoError(422, "حدد شهر الرواتب");
  if (String(b.description ?? "").trim().length < 3) throw new DemoError(422, "اكتب وصف الواقعة");
  const amount = Math.round(Number(b.amount) * 100) / 100;
  const s = monthSums(e.id, month);
  const err = validateDeduction({ kind, amount, incident: String(b.incident_date), today: hrToday(), dwage: dailyWage(e.basic_wage, e.housing_allowance),
    monthlyWage: e.basic_wage + e.housing_allowance, monthFines: s.fines, monthTotal: s.total });
  if (err) throw new DemoError(422, err);
  const n: DemoNotice = { id: uid(), employee_id: e.id, kind, incident_date: String(b.incident_date), description: String(b.description), amount, payroll_month: month,
    status: "ISSUED", seen_at: null, objection_text: null, objected_at: null, decision_note: null, decided_at: null, created_at: new Date().toISOString(),
    leave_request_id: (b.leave_request_id as string) || null };
  noticesDemo.unshift(n); return { id: n.id };
}
(() => {
  const by = (n: string) => employeesDemo.find((e) => e.full_name === n)!;
  const t = hrToday(), d = (n: number) => isoAddDays(t, n);
  const nextWorkday = (s: string) => { let x = s; while (!attSettings.work_days.includes(weekday0(x))) x = isoAddDays(x, 1); return x; };
  const mk = (n: string, type: LeaveType, s: string, e: string, st: DemoLeave["status"], src: DemoLeave["source"], extra: Partial<DemoLeave> = {}) =>
    leavesDemo.push({ id: uid(), employee_id: by(n).id, leave_type: type, start_date: s, end_date: e, days: hrDaysOf(type, s, e), reason: null, medical_ref: null,
      status: st, source: src, decision_note: null, decided_at: st === "PENDING" ? null : ts(-5), return_date: null, return_submitted_at: null,
      return_confirmed_at: null, created_at: ts(-6), is_paid: true, ...extra });
  const s1 = nextWorkday(d(14));
  mk("فهد القحطاني", "ANNUAL", s1, isoAddDays(s1, 11), "PENDING", "LINK", { reason: "إجازة عائلية" });
  mk("رامش كومار", "SICK", d(-1), d(1), "PENDING", "LINK", { medical_ref: "SL-2026-4471", reason: "التهاب حاد",
    attachment: { name: "تقرير-طبي.pdf", mime: "application/pdf", b64: DEMO_REPORT_B64 } });
  mk("ريم السبيعي", "ANNUAL", d(-2), d(6), "APPROVED", "LINK");
  mk("محمد رفيق", "EMERGENCY", d(-6), d(-4), "APPROVED", "BOT", { reason: "ظرف عائلي", is_paid: false });
  mk("أحمد حسن", "ANNUAL", d(-30), d(-20), "APPROVED", "HR", { return_date: d(-16), return_submitted_at: ts(-16), return_confirmed_at: ts(-16) });
  mk("جون ماثيو", "REGULAR", d(-40), d(-36), "REJECTED", "LINK", { decision_note: "ذروة تسليم المشروع" });
  if (employeesDemo[1]) employeesDemo[1].mobile = "+966500000041";
  by("سلطان المطيري").mobile = "+966500000042";
  const late = attRecords.find((r) => r.kind === "IN" && (r.late_minutes ?? 0) > 0);
  if (late) {
    const e = hrEmp(late.employee_id); const day = riyadhIso(new Date(new Date(late.at).getTime() + 3 * 3600e3)).slice(0, 10);
    noticesDemo.push({ id: uid(), employee_id: e.id, kind: "LATE", incident_date: day, description: `تأخر ${late.late_minutes} دقيقة عن بداية الدوام يوم ${day}`,
      amount: lateAmount(late.late_minutes ?? 0, dailyWage(e.basic_wage, e.housing_allowance), workMinutes()), payroll_month: monthOf(day), status: "OBJECTED",
      seen_at: ts(-2), objection_text: "تأخرت بسبب حادث مروري على الطريق، ومعي إثبات من نجم.", objected_at: ts(-1), decision_note: null, decided_at: null,
      created_at: ts(-3), leave_request_id: null });
    late.late_minutes = late.late_minutes;
  }
  const v = by("عبدالله الشهري");
  noticesDemo.push({ id: uid(), employee_id: v.id, kind: "VIOLATION", incident_date: d(-4), description: "عدم ارتداء معدات السلامة في الموقع (إنذار سابق بتاريخ سابق)",
    amount: Math.round(dailyWage(v.basic_wage, v.housing_allowance) * 0.25 * 100) / 100, payroll_month: monthOf(t), status: "ISSUED", seen_at: null, objection_text: null,
    objected_at: null, decision_note: null, decided_at: null, created_at: ts(-1), leave_request_id: null });
})();
function hrOverviewDemo() {
  const access = addonAccess("ATTENDANCE");
  if (!access.via) throw new DemoError(402, "خدمة الإجازات ضمن إضافة «الحضور والإجازات والخصومات».");
  const y = Number(hrToday().slice(0, 4));
  const leaves = annotateSickDemo(leavesDemo.map(leaveRowDemo)).sort((a, b) => Number(b.status === "PENDING") - Number(a.status === "PENDING") || b.start_date.localeCompare(a.start_date));
  return { access, can_manage: true, settings: { ...hrSettingsDemo },
    policies: LEAVE_TYPES.map((t) => ({ ...hrPoliciesDemo[t], leave_type: t, label: LEAVE_LABEL[t] })),
    people: employeesDemo.filter((e) => e.is_active).map((e) => ({ id: e.id, full_name: e.full_name, job_title: e.job_title, mobile: e.mobile ?? null, ...balanceOf(e.id, y) }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "ar")),
    leaves, stats: { pending: leaves.filter((l) => l.status === "PENDING").length, on_leave: leaves.filter((l) => l.on_leave_now).length,
      awaiting_return: leaves.filter((l) => l.awaiting_return).length } };
}
function deductionsDemo(month: string) {
  const m = `${month}-01`, today = hrToday();
  const notices = noticesDemo.filter((n) => n.payroll_month === m).map((n) => ({ ...n, full_name: hrEmp(n.employee_id).full_name, kind_label: KIND_LABEL[n.kind] }));
  const have = new Set(noticesDemo.filter((n) => n.status !== "CANCELLED").map((n) => `${n.employee_id}|${n.kind}|${n.incident_date}`));
  const haveLeave = new Set(noticesDemo.filter((n) => n.status !== "CANCELLED" && n.leave_request_id).map((n) => n.leave_request_id));
  const local = (at: string) => riyadhIso(new Date(new Date(at).getTime() + 3 * 3600e3)).slice(0, 10);
  const sug: DeductionSuggestion[] = [];
  const lateByDay = new Map<string, number>();
  for (const r of attRecords) if (r.kind === "IN" && r.status === "ACCEPTED" && (r.late_minutes ?? 0) > 0 && local(r.at).startsWith(month)) {
    const k = `${r.employee_id}|${local(r.at)}`; lateByDay.set(k, Math.max(lateByDay.get(k) ?? 0, r.late_minutes ?? 0));
  }
  for (const [k, min] of lateByDay) {
    const [eid, day] = k.split("|"); const e = employeesDemo.find((x) => x.id === eid && x.is_active);
    if (!e || have.has(`${eid}|LATE|${day}`) || diffDays(today, day) > 30) continue;
    sug.push({ employee_id: eid, full_name: e.full_name, kind: "LATE", kind_label: KIND_LABEL.LATE, incident_date: day,
      amount: lateAmount(min, dailyWage(e.basic_wage, e.housing_allowance), workMinutes()), description: `تأخر ${min} دقيقة عن بداية الدوام يوم ${day}` });
  }
  const present = new Set(attRecords.filter((r) => r.kind === "IN" && r.status === "ACCEPTED").map((r) => `${r.employee_id}|${local(r.at)}`));
  const firstRec = new Map<string, string>();
  for (const r of attRecords) { const d = local(r.at); if (!firstRec.has(r.employee_id) || d < firstRec.get(r.employee_id)!) firstRec.set(r.employee_id, d); }
  const hol = hrHolidays();
  for (let d = m; d.startsWith(month) && d < today; d = isoAddDays(d, 1)) {
    if (!attSettings.work_days.includes(weekday0(d)) || hol.has(d)) continue;
    for (const [eid, since] of firstRec) {
      const e = employeesDemo.find((x) => x.id === eid && x.is_active);
      if (!e || d < since || present.has(`${eid}|${d}`) || have.has(`${eid}|ABSENCE|${d}`)) continue;
      if (leavesDemo.some((l) => l.employee_id === eid && l.status === "APPROVED" && l.start_date <= d && d <= l.end_date)) continue;
      sug.push({ employee_id: eid, full_name: e.full_name, kind: "ABSENCE", kind_label: KIND_LABEL.ABSENCE, incident_date: d,
        amount: dailyWage(e.basic_wage, e.housing_allowance), description: `غياب يوم ${d} دون إجازة أو تسجيل حضور` });
    }
  }
  for (const l of leavesDemo) {
    if (l.status !== "APPROVED" || !l.return_date || !l.return_date.startsWith(month) || haveLeave.has(l.id)) continue;
    const n = lateReturnDays(l.end_date, l.return_date, attSettings.work_days, hol); if (!n) continue;
    const e = hrEmp(l.employee_id);
    sug.push({ employee_id: e.id, full_name: e.full_name, kind: "LATE_RETURN", kind_label: KIND_LABEL.LATE_RETURN, incident_date: l.return_date, leave_request_id: l.id,
      amount: Math.round(n * dailyWage(e.basic_wage, e.housing_allowance) * 100) / 100, description: `تأخر ${n} يوم عمل عن المباشرة بعد الإجازة ال${LEAVE_LABEL[l.leave_type]} (انتهت ${l.end_date})` });
  }
  sug.sort((a, b) => a.incident_date.localeCompare(b.incident_date) || a.full_name.localeCompare(b.full_name, "ar"));
  const summary = [...new Set(notices.map((n) => n.employee_id))].flatMap((eid) => {
    const e = hrEmp(eid); const live = notices.filter((n) => n.employee_id === eid && ["ISSUED", "OBJECTED", "CONFIRMED"].includes(n.status));
    if (!live.length) return [];
    return [{ employee_id: eid, full_name: e.full_name, fines: live.filter((n) => FINE_KINDS.includes(n.kind)).reduce((a, n) => a + n.amount, 0),
      total: live.reduce((a, n) => a + n.amount, 0), confirmed: live.filter((n) => n.status === "CONFIRMED").reduce((a, n) => a + n.amount, 0),
      fine_cap: Math.round(dailyWage(e.basic_wage, e.housing_allowance) * 500) / 100, half_wage: (e.basic_wage + e.housing_allowance) / 2 }];
  });
  const [yy, mm] = month.split("-").map(Number);
  const mStart = `${month}-01`, mEnd = isoAddDays(mm === 12 ? `${yy + 1}-01-01` : `${yy}-${String(mm + 1).padStart(2, "0")}-01`, -1);
  const unpaid_leaves = leavesDemo.filter((l) => l.status === "APPROVED" && !l.is_paid && l.start_date <= mEnd && l.end_date >= mStart).flatMap((l) => {
    const e = employeesDemo.find((x) => x.id === l.employee_id); if (!e) return [];
    const a = l.start_date > mStart ? l.start_date : mStart, b = l.end_date < mEnd ? l.end_date : mEnd;
    const days = hrDaysOf(l.leave_type, a, b); if (!days) return [];
    return [{ leave_id: l.id, employee_id: l.employee_id, full_name: e.full_name, leave_type: l.leave_type, label: LEAVE_LABEL[l.leave_type], from_date: a, to_date: b,
      days, amount: round2(days * dailyWage(e.basic_wage, e.housing_allowance)) }];
  });
  return { month, notices, suggestions: sug, summary, unpaid_leaves, objection_days: hrSettingsDemo.objection_days };
}
function personHrDemo(empId: string) {
  const y = Number(hrToday().slice(0, 4));
  for (const n of noticesDemo) if (n.employee_id === empId && !n.seen_at) n.seen_at = new Date().toISOString();
  return { balance: balanceOf(empId, y), objection_days: hrSettingsDemo.objection_days, count_workdays_only: hrSettingsDemo.count_workdays_only,
    policies: LEAVE_TYPES.filter((t) => hrPoliciesDemo[t].is_active).map((t) => ({ ...hrPoliciesDemo[t], leave_type: t, label: LEAVE_LABEL[t], used: usedOf(empId, y, [t]) })),
    leaves: annotateSickDemo(leavesDemo.filter((l) => l.employee_id === empId).map((l) => ({ ...leavePublic(l), label: LEAVE_LABEL[l.leave_type] })))
      .sort((a, b) => b.start_date.localeCompare(a.start_date)),
    notices: noticesDemo.filter((n) => n.employee_id === empId) };
}
function submitReturnDemo(l: DemoLeave, date: string, byHr: boolean) {
  if (l.status !== "APPROVED") throw new DemoError(409, "المباشرة تكون بعد إجازة موافق عليها");
  if (l.return_confirmed_at) throw new DemoError(409, "أُكدت المباشرة مسبقاً");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= l.start_date) throw new DemoError(422, "تاريخ المباشرة يجب أن يكون بعد بداية الإجازة");
  if (!byHr && date > hrToday()) throw new DemoError(422, "تُسجَّل المباشرة يوم عودتك للعمل، لا قبله");
  l.return_date = date; l.return_submitted_at ??= new Date().toISOString();
  if (byHr) l.return_confirmed_at = new Date().toISOString();
  return { late_days: lateReturnDays(l.end_date, date, attSettings.work_days, hrHolidays()) };
}
function hrPublicRoute(method: string, p: string, body: Record<string, unknown>): unknown {
  const m = p.match(/^\/public\/attendance\/([^/]+)\/(hr|leaves|leaves\/([^/]+)\/(cancel|return|attachment)|notices\/([^/]+)\/object)$/);
  if (!m) return NO_ROUTE;
  const e = attPerson(decodeURIComponent(m[1]));
  if (m[2] === "hr") return personHrDemo(e.id);
  if (m[2] === "leaves" && method === "POST") return createLeaveDemo(e.id, body, "LINK", false, false);
  if (m[3]) {
    const l = leavesDemo.find((x) => x.id === m[3] && x.employee_id === e.id); if (!l) throw new DemoError(404, "الطلب غير موجود");
    if (m[4] === "cancel") { if (l.status !== "PENDING") throw new DemoError(409, "يمكن إلغاء الطلب قبل البت فيه فقط"); l.status = "CANCELLED"; return { ok: true }; }
    if (m[4] === "attachment") {
      if (l.status !== "PENDING") throw new DemoError(409, "يُرفق التقرير قبل البت في الطلب فقط. تواصل مع الموارد البشرية.");
      l.attachment = demoAttachment(body); if (!l.attachment) throw new DemoError(422, "المرفق فارغ"); return { ok: true };
    }
    return submitReturnDemo(l, String(body.return_date ?? ""), false);
  }
  const n = noticesDemo.find((x) => x.id === m[5] && x.employee_id === e.id); if (!n) throw new DemoError(404, "الإشعار غير موجود");
  if (n.status !== "ISSUED") throw new DemoError(409, "لا يمكن الاعتراض على هذا الإشعار الآن");
  if (String(body.objection ?? "").trim().length < 5) throw new DemoError(422, "اكتب سبب الاعتراض");
  if (Date.now() - new Date(n.created_at).getTime() > hrSettingsDemo.objection_days * 864e5) throw new DemoError(409, `انتهت مهلة الاعتراض (${hrSettingsDemo.objection_days} يوماً)`);
  Object.assign(n, { status: "OBJECTED", objection_text: String(body.objection), objected_at: new Date().toISOString() });
  return { ok: true };
}
function eventsViewDemo() {
  const t = hrToday();
  return { events: eventsDemo.filter((e) => e.is_active && e.event_date >= isoAddDays(t, -1) && e.event_date < isoAddDays(t, 400)).sort((a, b) => a.event_date.localeCompare(b.event_date)),
    can_manage: true, settings: { ...orgEventsDemo, excluded_codes: [...orgEventsDemo.excluded_codes] }, org_name: orgs.find((o) => o.id === ORG_A)!.name,
    reachable_employees: employeesDemo.filter((e) => e.is_active && (e.mobile || botMembers.some((b) => b.employee_id === e.id && b.status === "ACTIVE"))).length, sent_total: 0 };
}
function eventInput(b: Record<string, unknown>): Omit<AnnualEvent, "id"> {
  const code = String(b.code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9_]{2,30}$/.test(code)) throw new DemoError(422, "الرمز بالإنجليزية الكبيرة والأرقام و_ فقط");
  if (String(b.name ?? "").trim().length < 2) throw new DemoError(422, "اكتب اسم المناسبة");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.event_date ?? ""))) throw new DemoError(422, "حدد التاريخ");
  if (String(b.greeting ?? "").trim().length < 5) throw new DemoError(422, "اكتب نص التهنئة");
  const kind = ["NATIONAL", "RELIGIOUS", "OCCASION"].includes(String(b.kind)) ? String(b.kind) as AnnualEvent["kind"] : "OCCASION";
  return { code, name: String(b.name), event_date: String(b.event_date), kind, is_holiday: !!b.is_holiday, holiday_days: Math.min(Math.max(Number(b.holiday_days) || 0, 0), 14),
    greeting: String(b.greeting), notify_subscribers: b.notify_subscribers !== false, is_active: b.is_active !== false };
}
function adminEventsRoute(method: string, p: string, body: Record<string, unknown>): unknown {
  if (p === "/admin/events" && method === "GET")
    return { events: eventsDemo.filter((e) => e.event_date >= isoAddDays(hrToday(), -60)).sort((a, b) => a.event_date.localeCompare(b.event_date)), orgs_enabled: orgEventsDemo.enabled ? 1 : 0 };
  if (p === "/admin/events" && method === "POST") {
    const x = eventInput(body);
    if (eventsDemo.some((e) => e.code === x.code && e.event_date === x.event_date)) throw new DemoError(409, "المناسبة مضافة بهذا التاريخ");
    const ev = { id: uid(), ...x, sent_subscribers: 0, sent_employees: 0 }; eventsDemo.push(ev); log("ADMIN_EVENT_CREATE", null, { name: ev.name }); return { id: ev.id };
  }
  const m = p.match(/^\/admin\/events\/([^/]+)$/);
  if (m && method === "PUT") {
    const ev = eventsDemo.find((e) => e.id === m[1]); if (!ev) throw new DemoError(404, "المناسبة غير موجودة");
    Object.assign(ev, eventInput(body)); log("ADMIN_EVENT_UPDATE", null, { name: ev.name }); return { ok: true };
  }
  return NO_ROUTE;
}
function hrRoute(method: string, p: string, q: URLSearchParams, body: Record<string, unknown>): unknown {
  let m: RegExpMatchArray | null;
  if (p === "/events" && method === "GET") return eventsViewDemo();
  if (p === "/events/settings" && method === "PUT") {
    Object.assign(orgEventsDemo, { enabled: !!body.enabled, signature: String(body.signature ?? "").trim() || null,
      excluded_codes: ((body.excluded_codes as string[]) ?? []).slice(0, 30) }); return { ok: true };
  }
  if (!p.startsWith("/hr/")) return NO_ROUTE;
  if (p === "/hr/overview") return hrOverviewDemo();
  if (!addonAccess("ATTENDANCE").via) throw new DemoError(402, "خدمة الإجازات ضمن إضافة «الحضور والإجازات والخصومات».");
  if (p === "/hr/settings" && method === "PUT") {
    const d = Number(body.objection_days); if (!(d >= 1 && d <= 60)) throw new DemoError(422, "مهلة الاعتراض بين 1 و60 يوماً");
    Object.assign(hrSettingsDemo, { count_workdays_only: !!body.count_workdays_only, objection_days: d, notify_employees: !!body.notify_employees }); return { ok: true };
  }
  if ((m = p.match(/^\/hr\/policies\/([A-Z]+)$/)) && method === "PUT") {
    const t = m[1] as LeaveType; if (!LEAVE_TYPES.includes(t)) throw new DemoError(404, "نوع غير معروف");
    const n = (v: unknown) => (v == null || v === "" ? null : Number(v));
    const mode = (["PAID", "UNPAID", "CHOICE"].includes(String(body.pay_mode)) ? body.pay_mode : "PAID") as PayMode;
    if ((t === "ANNUAL" || t === "SICK") && mode !== "PAID") throw new DemoError(422, "الإجازة السنوية والمرضية مدفوعة نظاماً (المرضية بشرائح المادة 117)");
    Object.assign(hrPoliciesDemo[t], { pay_mode: mode, is_paid: mode !== "UNPAID", from_balance: !!body.from_balance, max_days_per_request: n(body.max_days_per_request),
      yearly_cap: n(body.yearly_cap), min_notice_days: Number(body.min_notice_days) || 0, is_active: body.is_active !== false }); return { ok: true };
  }
  if ((m = p.match(/^\/hr\/leaves\/([^/]+)\/attachment$/))) {
    const l = leavesDemo.find((x) => x.id === m![1]);
    if (!l?.attachment) throw new DemoError(404, "لا يوجد مرفق");
    return { __file: l.attachment.b64, mime: l.attachment.mime };
  }
  if (p === "/hr/leaves" && method === "POST") { hrEmp(String(body.employee_id)); return createLeaveDemo(String(body.employee_id), body, "HR", true, body.approve !== false); }
  if ((m = p.match(/^\/hr\/leaves\/([^/]+)\/(decide|cancel|return)$/))) {
    const l = leavesDemo.find((x) => x.id === m![1]); if (!l) throw new DemoError(404, "الطلب غير موجود");
    if (m[2] === "decide") {
      if (l.status !== "PENDING") throw new DemoError(409, "تم البت في هذا الطلب مسبقاً");
      if (body.approve && typeof body.is_paid === "boolean" && body.is_paid !== l.is_paid) {
        const pol = hrPoliciesDemo[l.leave_type];
        if (pol.pay_mode !== "CHOICE") throw new DemoError(422, "سياسة هذا النوع لا تسمح بتغيير الأجر");
        if (body.is_paid && pol.from_balance) { const b = balanceOf(l.employee_id, Number(l.start_date.slice(0, 4))).balance;
          if (l.days > b) throw new DemoError(422, `الرصيد غير كافٍ: المتبقي ${fmtDays(b)} يوم`); }
        l.is_paid = body.is_paid;
      }
      Object.assign(l, { status: body.approve ? "APPROVED" : "REJECTED", decided_at: new Date().toISOString(), decision_note: (body.note as string) || null });
      return { status: l.status };
    }
    if (m[2] === "cancel") {
      if (!["PENDING", "APPROVED"].includes(l.status) || l.return_date) throw new DemoError(409, "لا يمكن إلغاء هذا الطلب");
      l.status = "CANCELLED"; return { ok: true };
    }
    return submitReturnDemo(l, String(body.return_date ?? ""), true);
  }
  if ((m = p.match(/^\/hr\/employees\/([^/]+)\/adjust$/))) {
    hrEmp(m[1]); const d = Number(body.days);
    if (!d || Math.abs(d) > 365) throw new DemoError(422, "أدخل عدد أيام غير صفري"); if (String(body.note ?? "").trim().length < 2) throw new DemoError(422, "اكتب سبب التعديل");
    leaveAdj.push({ employee_id: m[1], year: Number(hrToday().slice(0, 4)), days: d, note: String(body.note) }); return { ok: true };
  }
  if (p === "/hr/deductions" && method === "GET") return deductionsDemo(q.get("month") ?? hrToday().slice(0, 7));
  if (p === "/hr/deductions" && method === "POST") return createNoticeDemo(body);
  if ((m = p.match(/^\/hr\/deductions\/([^/]+)\/decide$/))) {
    const n = noticesDemo.find((x) => x.id === m![1]); if (!n) throw new DemoError(404, "الإشعار غير موجود");
    if (!["ISSUED", "OBJECTED"].includes(n.status)) throw new DemoError(409, "تم البت في هذا الإشعار مسبقاً");
    Object.assign(n, { status: body.confirm ? "CONFIRMED" : "CANCELLED", decided_at: new Date().toISOString(), decision_note: (body.note as string) || null }); return { ok: true };
  }
  return NO_ROUTE;
}
function hrBotReply(member: DemoBotMember | null, what: string): string {
  if (!member) return "في التجربة بصفة المدير لا يوجد سجل موظف. اختر موظفاً مربوطاً لتجربة الإجازات.";
  if (!addonAccess("ATTENDANCE").via) return "خدمة الإجازات غير مفعّلة لمنشأتك. تواصل مع الموارد البشرية.";
  if (!member.employee_id) return "رقمك غير مربوط بسجلك الوظيفي. اطلب من الموارد البشرية ربطه من صفحة بوت الموظفين.";
  const eid = member.employee_id;
  if (what === "balance") {
    const b = balanceOf(eid, Number(hrToday().slice(0, 4)));
    const pend = leavesDemo.filter((l) => l.employee_id === eid && l.status === "PENDING").length;
    return `رصيد إجازتك السنوية لعام ${b.year}: ${fmtDays(b.balance)} يوم\n(الاستحقاق ${b.entitlement}، المستخدم ${b.used}${b.adjustments ? `، تعديلات ${fmtDays(b.adjustments)}` : ""})`
      + (pend ? `\nلديك ${pend} طلب بانتظار القرار.` : "") + "\nلرفع إجازة اكتب «إجازة».";
  }
  attLinks.add(eid);
  const url = `${attLinkUrl(eid)}&tab=${what === "notices" ? "notices" : "leave"}`;
  if (what === "notices") {
    const n = noticesDemo.filter((x) => x.employee_id === eid && x.status === "ISSUED").length;
    return (n ? `لديك ${n} إشعار خصم قائم.` : "لا توجد إشعارات خصم قائمة.") + `\nللاطلاع أو الاعتراض (لا تشارك الرابط):\n${url}`;
  }
  return `رابط الإجازات الخاص بك (لا تشاركه): ارفع إجازة سنوية أو اعتيادية أو اضطرارية أو مرضية، أو سجّل مباشرتك بعد العودة:\n${url}`;
}

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
  if (p === "/public/pricing") { const pr = promoView(false); return { ...pricingView(), promo: { code: pr.code, name: pr.name, free_months: pr.free_months, remaining: pr.remaining, active: pr.active } }; }
  if (method === "POST" && p === "/public/signup") {
    if (!body.consent) throw new DemoError(422, "يلزم الموافقة على الشروط وسياسة الخصوصية");
    if (!/^\d{10}$/.test(String(body.cr_number ?? ""))) throw new DemoError(422, "السجل التجاري 10 أرقام");
    if (String(body.password ?? "").length < 10) throw new DemoError(422, "كلمة المرور 10 أحرف على الأقل");
    if (!/^\S+@\S+\.\S+$/.test(String(body.email ?? ""))) throw new DemoError(422, "البريد الإلكتروني غير صحيح");
    if (orgs.some((o) => o.cr === body.cr_number)) throw new DemoError(409, "هذا السجل التجاري مسجّل في حصيف. اطلب من مدير منشأتك دعوتك، أو تواصل معنا.");
    // نسخة العرض: تُفتح منشأة العرض نفسها بمعالج الإعداد، وتُعرض بيانات التسجيل كما أُدخلت
    const o = orgs.find((x) => x.id === ORG_A)!;
    o.name = String(body.company_name || o.name); o.legal = String(body.entity_legal_type || o.legal);
    o.sub = { id: o.sub?.id ?? uid(), plan_tier: String(body.plan_tier ?? "PROFESSIONAL_GRC"), billing_cycle: "MONTHLY", billing_status: "TRIAL", starts_at: new Date().toISOString(), ends_at: ts(14) };
    for (const pl of plansDemo) if (pl.org_id === ORG_A && pl.status === "ACTIVE") pl.status = "CANCELED";
    onboardingNeeded = true; emailVerified = false;
    return { access_token: "demo-client", org_id: ORG_A, trial_days: 14 };
  }
  if (method === "POST" && p === "/public/verify-email") { emailVerified = true; return { verified: true }; }
  if (p.startsWith("/public/attendance/")) { const h = hrPublicRoute(method, p, body); return h !== NO_ROUTE ? h : attendancePublicRoute(method, p, body); }
  if (!token) throw new DemoError(401, "سجّل الدخول أولاً");
  const role = TEAM_ROLE[token];
  const isAdmin = !!role;
  if (p === "/auth/me") return isAdmin ? { ...ADMIN_ME, ...TEAM_ME[role] } : CLIENT_ME;
  if (p === "/auth/change-password") return undefined;

  if (p.startsWith("/admin")) {
    if (!isAdmin) throw new DemoError(403, "هذه الواجهة لفريق حصيف فقط");
    if (p === "/admin/me") return { user_id: TEAM_ME[role].id, role, role_name: adminRoles.find((r) => r.code === role)?.name ?? role, permissions: permsOf(role) };
    actor = { name: TEAM_ME[role]?.full_name ?? role, role };
    requirePerm(role, method, p, body);
    if (p === "/admin/pricing" && method === "GET") return { ...pricingView(), promotions: [promoView(false)], hr_mix: hrMixDemo() };
    if ((m = p.match(/^\/admin\/pricing\/promotions\/([A-Z_]+)$/)) && method === "PUT") {
      if (m![1] !== promoDemo.code) throw new DemoError(404, "العرض غير موجود");
      const mx = Number(body.max_redemptions); if (!(mx >= 1)) throw new DemoError(422, "حد غير صحيح");
      if (mx < promoDemo.used) throw new DemoError(422, `استفاد ${promoDemo.used} مشتركاً بالفعل؛ لا يقل الحد عنهم`);
      Object.assign(promoDemo, { is_active: body.is_active !== false, max: mx, free_months: Math.min(Math.max(Number(body.free_months) || 1, 1), 12) });
      log("ADMIN_PROMO", null, { code: promoDemo.code }); return { ok: true };
    }
    { const g = adminEventsRoute(method, p, body); if (g !== NO_ROUTE) return g; }
    if ((m = p.match(/^\/admin\/pricing\/plans\/([A-Z_]+)$/))) {
      const tier = m[1]; if (!PRICES[tier]) throw new DemoError(404, "الباقة غير موجودة");
      const mo = Number(body.monthly_price_sar), yr = Number(body.yearly_price_sar);
      if (!(mo > 0 && yr > 0)) throw new DemoError(422, "السعر يجب أن يكون أكبر من صفر");
      PRICES[tier] = [mo, yr]; QUOTA[tier] = body.monthly_whatsapp_alerts == null || body.monthly_whatsapp_alerts === "" ? null : Number(body.monthly_whatsapp_alerts);
      log("ADMIN_PLAN_PRICE", null, { tier, monthly: mo, yearly: yr }); return { ok: true };
    }
    if ((m = p.match(/^\/admin\/pricing\/addons\/([A-Z_]+)$/))) {
      const a = addonCatalog.find((x) => x.code === m![1]); if (!a) throw new DemoError(404, "الإضافة غير موجودة");
      const price = Number(body.monthly_price); if (!(price >= 0)) throw new DemoError(422, "سعر غير صحيح");
      Object.assign(a, { monthly_price: price, included_tiers: [...new Set((body.included_tiers as string[]) ?? [])], is_active: body.is_active !== false });
      Object.assign(a.limits, { members: body.members == null ? null : Number(body.members), questions: body.questions == null ? null : Number(body.questions), included_unlimited: !!body.included_unlimited });
      log("ADMIN_ADDON_PRICE", null, { code: a.code, price }); return { ok: true };
    }
    if (p === "/admin/gosi-rates" && method === "GET") return GOSI_RATES.map((r, i) => ({ ...r, id: i + 1, updated_at: ts(-30) }));
    if (p === "/admin/gosi-rates" && method === "PUT") {
      const r = body as unknown as (typeof GOSI_RATES)[number];
      if (!r.effective_from || !["OLD", "NEW", "NON_SAUDI"].includes(r.system)) throw new DemoError(422, "أكمل النظام وتاريخ السريان");
      const k = GOSI_RATES.findIndex((x) => x.system === r.system && x.effective_from === r.effective_from);
      const row = { ...r, employee_annuity: +r.employee_annuity, employer_annuity: +r.employer_annuity, employee_saned: +r.employee_saned,
        employer_saned: +r.employer_saned, employer_hazards: +r.employer_hazards, min_base: +(r.min_base ?? 1500), max_base: +(r.max_base ?? 45000) };
      if (k >= 0) GOSI_RATES[k] = row; else GOSI_RATES.push(row);
      GOSI_RATES.sort((a, b) => a.system.localeCompare(b.system) || a.effective_from.localeCompare(b.effective_from));
      log("ADMIN_GOSI_RATE", null, row);
      return { id: k >= 0 ? k + 1 : GOSI_RATES.length };
    }
    if (p === "/admin/overview") { const ov = overview(); return canDo(role, "finance.view") ? ov : { ...ov, kpis: { ...ov.kpis, mrr_sar: null } }; }
    if (p === "/admin/organizations" && method === "GET") return orgs.map(orgRow).map((r) => canDo(role, "orgs.view") ? r : { ...r, haseef_score: null });
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
        if (canDo(role, "orgs.view") && !canDo(role, "finance.view")) return { ...full, restricted: false,
          subscription: full.subscription && (({ monthly_price_sar: _m, yearly_price_sar: _y, ...rest }) => rest)(full.subscription),
          billing: full.billing.map((b) => ({ ...b, amount_sar: null, reference: null })) };
        if (canDo(role, "orgs.view")) return { ...full, restricted: false };
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
        o.billing.unshift({ event_type: "PLAN_CHANGED", plan_tier: s.plan_tier, amount_sar: null, period_months: null, reference: null, note: (body.note as string) ?? null, created_at: now, actor: actor.name });
        return { plan_tier: s.plan_tier };
      }
      if (m[2] === "extend-trial") {
        if (s.billing_status !== "TRIAL") throw new DemoError(409, "المنشأة ليست في فترة تجريبية");
        s.ends_at = new Date(new Date(s.ends_at).getTime() + Number(body.days) * DAY).toISOString();
        o.billing.unshift({ event_type: "TRIAL_EXTENDED", plan_tier: s.plan_tier, amount_sar: null, period_months: null, reference: null, note: `${body.days} يوماً`, created_at: now, actor: actor.name });
        log("ADMIN_EXTEND_TRIAL", o, { days: body.days }); return { ends_at: s.ends_at };
      }
      if (m[2] === "payment") {
        const months = body.billing_cycle === "YEARLY" ? 12 : 1;
        const base = s.billing_status === "TRIAL" ? Date.now() : Math.max(Date.now(), new Date(s.ends_at).getTime());
        const end = new Date(base); end.setMonth(end.getMonth() + months);
        Object.assign(s, { billing_status: "ACTIVE", billing_cycle: body.billing_cycle, plan_tier: body.plan_tier ?? s.plan_tier, ends_at: end.toISOString() });
        o.billing.unshift({ event_type: "PAYMENT", plan_tier: s.plan_tier, amount_sar: Number(body.amount_sar), period_months: months, reference: (body.reference as string) ?? null, note: (body.note as string) ?? null, created_at: now, actor: actor.name });
        log("ADMIN_RECORD_PAYMENT", o, { amount_sar: body.amount_sar, cycle: body.billing_cycle, reference: body.reference });
        const inv = subscriptionInvoice(o, s.plan_tier, Number(body.amount_sar), months, (body.reference as string) ?? null);
        return { status: "ACTIVE", invoice: { id: inv.id, number: inv.number } };
      }
      if (m[2] === "cancel") {
        s.billing_status = "CANCELED";
        o.billing.unshift({ event_type: "CANCELED", plan_tier: s.plan_tier, amount_sar: null, period_months: null, reference: null, note: String(body.reason), created_at: now, actor: actor.name });
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
    if (p === "/admin/team" && method === "GET")
      return team.filter((t) => t.platform_role).map((t) => ({ ...t, role_name: adminRoles.find((r) => r.code === t.platform_role)?.name ?? t.platform_role }));
    if (p === "/admin/team" && method === "POST") {
      const r = adminRoles.find((x) => x.code === body.role); if (!r) throw new DemoError(422, "الدور غير موجود");
      guardGrant(role, r);
      if (team.some((t) => t.email === String(body.email).toLowerCase())) throw new DemoError(409, "هذا الشخص عضو في الفريق أصلاً");
      team.push({ id: uid(), full_name: String(body.full_name), email: String(body.email).toLowerCase(), platform_role: r.code, is_active: true, last_login_at: null, must_change_password: true });
      log("ADMIN_TEAM_ADD", null, { email: body.email, role: r.code, role_name: r.name }); return { temporary_password: TEMP_PW };
    }
    if ((m = p.match(/^\/admin\/team\/([^/]+)$/))) {
      if (m[1] === TEAM_ME[role]?.id) throw new DemoError(409, "لا يمكنك تغيير دورك بنفسك");
      const t = team.find((x) => x.id === m![1]); if (!t) throw new DemoError(404, "العضو غير موجود");
      if (role !== "SUPER_ADMIN") {
        if (t.platform_role === "SUPER_ADMIN") throw new DemoError(403, "حساب المدير العام يديره مدير عام فقط");
        guardGrant(role, { code: t.platform_role, permissions: permsOf(t.platform_role) });
      }
      if (body.role) { const r = adminRoles.find((x) => x.code === body.role); if (!r) throw new DemoError(422, "الدور غير موجود"); guardGrant(role, r); }
      if (t.platform_role === "SUPER_ADMIN" && body.role !== "SUPER_ADMIN"
          && !team.some((x) => x !== t && x.platform_role === "SUPER_ADMIN" && x.is_active)) throw new DemoError(409, "لا يمكن: هذا آخر مدير عام");
      log("ADMIN_TEAM_ROLE", null, { from: adminRoles.find((x) => x.code === t.platform_role)?.name ?? t.platform_role,
        to: body.role ? adminRoles.find((x) => x.code === body.role)?.name ?? body.role : null });
      if (body.role) t.platform_role = String(body.role); else team.splice(team.indexOf(t), 1);
      return { role: body.role ?? null };
    }
    if (p === "/admin/roles" && method === "GET")
      return { roles: adminRoles.map((r) => ({ ...r, permissions: r.code === "SUPER_ADMIN" ? PERM_ALL : r.permissions,
        members: team.filter((t) => t.platform_role === r.code).length })), permissions: ADMIN_PERMISSIONS };
    if (p === "/admin/roles" || (m = p.match(/^\/admin\/roles\/([^/]+)$/))) {
      const perms = Array.isArray(body.permissions) ? [...new Set(body.permissions as string[])].sort() : [];
      const name = String(body.name ?? "").trim();
      const check = () => {
        if (name.length < 2) throw new DemoError(422, "اكتب اسم الدور");
        if (!perms.length) throw new DemoError(422, "اختر صلاحية واحدة على الأقل");
        if (perms.some((x) => !PERM_ALL.includes(x))) throw new DemoError(422, "صلاحية غير معروفة");
      };
      if (method === "POST") {
        check(); guardGrant(role, { code: "", permissions: perms });
        let code = String(body.code ?? "").trim().toUpperCase() || `ROLE_${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
        if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) throw new DemoError(422, "رمز الدور: أحرف إنجليزية كبيرة وأرقام و _ فقط");
        if (adminRoles.some((r) => r.code === code || r.name === name)) throw new DemoError(409, "يوجد دور بهذا الاسم أو الرمز");
        adminRoles.push({ code, name, description: (body.description as string) || null, permissions: perms, is_system: false,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
        log("ADMIN_ROLE_CREATE", null, { code, name, permissions: perms }); return { code };
      }
      const r = adminRoles.find((x) => x.code === m![1]); if (!r) throw new DemoError(422, "الدور غير موجود");
      if (method === "PATCH") {
        if (r.code === "SUPER_ADMIN") throw new DemoError(409, "دور المدير العام ثابت ويملك كل الصلاحيات");
        check(); guardGrant(role, r); guardGrant(role, { code: r.code, permissions: perms });
        if (adminRoles.some((x) => x.name === name && x.code !== r.code)) throw new DemoError(409, "يوجد دور بهذا الاسم");
        log("ADMIN_ROLE_UPDATE", null, { code: r.code, name, permissions: perms, before: r.permissions });
        Object.assign(r, { name, description: (body.description as string) || null, permissions: perms, updated_at: new Date().toISOString() });
        return { updated: true };
      }
      if (method === "DELETE") {
        if (r.is_system) throw new DemoError(409, "الأدوار الأساسية لا تُحذف، يمكنك تعديل صلاحياتها");
        guardGrant(role, r);
        if (team.some((t) => t.platform_role === r.code)) throw new DemoError(409, "الدور مسند لأعضاء؛ انقلهم لدور آخر أولاً");
        adminRoles.splice(adminRoles.indexOf(r), 1); log("ADMIN_ROLE_DELETE", null, { code: r.code, name: r.name });
        return { deleted: true };
      }
    }
    if (p.startsWith("/admin/finance/plans")) return plansRoute(method, p, q, body, TEAM_ME[role]?.full_name ?? role);
    if (p.startsWith("/admin/finance/")) return financeRoute(method, p, q, body, TEAM_ME[role]?.full_name ?? role);
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
      requested_by_name: "أحمد العتيبي", details: canDo(role, "legal.cases") ? c.details : null, lawyer_summary: canDo(role, "legal.cases") ? c.lawyer_summary : null }))
      .sort((a, b) => Number(["COMPLETED", "CANCELED"].includes(a.status)) - Number(["COMPLETED", "CANCELED"].includes(b.status)));
    if ((m = p.match(/^\/admin\/legal\/consultations\/([^/]+)\/(assign|complete|cancel|payment)$/))) {
      const c = consults.find((x) => x.id === m![1]); if (!c) throw new DemoError(404, "الطلب غير موجود");
      if (m[2] === "assign") { Object.assign(c, { lawyer_id: body.lawyer_id, scheduled_at: body.scheduled_at, meeting_link: body.meeting_link ?? null, status: "CONFIRMED" }); return { status: "CONFIRMED" }; }
      if (m[2] === "complete") { if (c.status !== "CONFIRMED") throw new DemoError(409, "الاستشارة غير مؤكدة"); Object.assign(c, { status: "COMPLETED", lawyer_summary: body.lawyer_summary ?? null }); return { status: "COMPLETED" }; }
      if (m[2] === "cancel") { Object.assign(c, { status: "CANCELED", cancel_reason: body.reason }); return { status: "CANCELED" }; }
      Object.assign(c, { payment_status: body.payment_status, payment_reference: body.payment_reference });
      let inv: DemoInvoice | null = null;
      if (body.payment_status === "PAID") inv = consultationInvoice(c, String(body.payment_reference));
      else { const orig = invoicesDemo.find((i) => i.consultation_id === c.id && i.kind === "INVOICE" && i.status === "ISSUED");
             if (orig) inv = voidInvoice(orig, `استرداد الاستشارة (${body.payment_reference})`); }
      return { payment_status: body.payment_status, invoice: inv ? { id: inv.id, number: inv.number } : null };
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
      return audit.filter((a) => (!id || a.org_id === id) && (canDo(role, "orgs.view") || billingOnly.includes(a.action)))
        .map((a) => !canDo(role, "finance.view") && a.changes ? { ...a, changes: Object.fromEntries(Object.entries(a.changes).filter(([k]) => k !== "amount_sar" && k !== "reference")) } : a);
    }
    if (p === "/admin/dispatches") return dispatches();
    if (p === "/admin/trial-requests") return trials;
    if ((m = p.match(/^\/admin\/trial-requests\/([^/]+)$/))) {
      const t = trials.find((x) => x.id === m![1]); if (!t) throw new DemoError(404, "الطلب غير موجود");
      Object.assign(t, { status: String(body.status), notes: (body.notes as string) ?? null, updated_at: new Date().toISOString(),
        handled_by_name: TEAM_ME[role]?.full_name ?? role }); return { updated: true };
    }
    if (p === "/admin/ai-usage") return orgs.map((o) => ({ org_id: o.id, name: o.name, plan_tier: o.sub?.plan_tier ?? null,
      quota: o.sub?.plan_tier === "ESSENTIAL" ? 3 : 15, audits_this_month: o.id === ORG_A ? 4 : 0, tokens: o.id === ORG_A ? 48_200 : 0, cost_sar: !canDo(role, "finance.view") ? null : o.id === ORG_A ? 3.6 : 0 }));
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

  { const g = growthRoute(method, p, body); if (g !== NO_ROUTE) return g; }
  { const g = attendanceRoute(method, p, q, body); if (g !== NO_ROUTE) return g; }
  { const g = hrRoute(method, p, q, body); if (g !== NO_ROUTE) return g; }

  // ---------- العمل والموظفين
  if (p === "/labor/overview") return laborOverviewDemo();
  if (p === "/labor/rates") return GOSI_RATES;
  if (p === "/labor/profile" && method === "PUT") {
    const d = Number(body.salary_day);
    if (!(d >= 1 && d <= 28)) throw new DemoError(422, "يوم الرواتب بين 1 و28");
    laborProfileDemo = { salary_day: d, nitaqat_band: (body.nitaqat_band as string) || null, nitaqat_checked_on: (body.nitaqat_checked_on as string) || null,
      gosi_employer_no: (body.gosi_employer_no as string) || null };
    for (const t of laborTasksDemo) if (t.kind === "SALARY_PAYMENT" && !t.done_at) t.due_date = taskDueDate("SALARY_PAYMENT", t.period, d);
    return { ok: true };
  }
  if ((m = p.match(/^\/labor\/tasks\/([^/]+)\/(done|reopen)$/))) {
    const t = laborTasksDemo.find((x) => x.id === m![1]); if (!t) throw new DemoError(404, "المهمة غير موجودة");
    if (m[2] === "done") {
      if (t.done_at) throw new DemoError(409, "المهمة منجزة");
      t.done_at = new Date().toISOString(); t.reference = (body.reference as string) || null; t.done_by_name = "أحمد العتيبي";
      if (body.amount != null && body.amount !== "") t.amount = Number(body.amount);
    } else {
      if (!t.done_at) throw new DemoError(409, "المهمة غير منجزة");
      t.done_at = null; t.done_by_name = null;
    }
    return { ok: true };
  }
  if (p === "/labor/employees" && method === "GET") return { employees: [...employeesDemo].sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.full_name.localeCompare(b.full_name, "ar")), show_wages: true };
  if (p === "/labor/employees" && method === "POST") { const x = { id: uid(), ...empInput(body), is_active: true, left_on: null }; employeesDemo.push(x); return { id: x.id }; }
  if (p === "/labor/employees/bulk") {
    const rows = (body.employees as Record<string, unknown>[]) ?? [];
    if (!rows.length) throw new DemoError(422, "لا صفوف للاستيراد");
    const parsed = rows.map(empInput);
    for (const r of parsed) employeesDemo.push({ id: uid(), ...r, is_active: true, left_on: null });
    return { imported: parsed.length };
  }
  if ((m = p.match(/^\/labor\/employees\/([^/]+)(\/leave)?$/))) {
    const x = employeesDemo.find((e) => e.id === m![1]); if (!x) throw new DemoError(404, "الموظف غير موجود");
    if (m[2]) { x.is_active = false; x.left_on = String(body.left_on); } else Object.assign(x, empInput(body));
    return { ok: true };
  }
  if (p === "/labor/gosi") return gosiMonthDemo(q.get("month") ? `${q.get("month")}-01` : monthStart(iso(riyadhToday())));
  if (p === "/labor/calculator") {
    const on = (body.on as string) || iso(riyadhToday());
    const r = pickRate(GOSI_RATES, rateSystem(body.nationality as Nationality, body.gosi_system as GosiSystem), on);
    if (!r) throw new DemoError(422, "لا توجد نسبة سارية في هذا التاريخ");
    return { ...contribution(Number(body.basic_wage) || 0, Number(body.housing_allowance) || 0, r), on };
  }

  // ---------- التنبيهات
  if (p === "/alerts/overview") return alertsOverview();
  if (p === "/alert-rules" && method === "PUT") {
    const t = String(body.target_type) as keyof typeof alertRules;
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

  if (p === "/billing/overview") {
    const o = orgs.find((x) => x.id === ORG_A)!;
    const plan = plansDemo.find((x) => x.org_id === ORG_A && x.status === "ACTIVE") ?? plansDemo.find((x) => x.org_id === ORG_A);
    const sub = o.sub ? { plan_tier: o.sub.plan_tier, billing_cycle: o.sub.billing_cycle, billing_status: o.sub.billing_status, starts_at: o.sub.starts_at,
      ends_at: o.sub.ends_at, monthly_price_sar: PRICES[o.sub.plan_tier][0], yearly_price_sar: PRICES[o.sub.plan_tier][1] } : null;
    return { subscription: sub, plan: plan ? planDetail(plan) : null, vat_rate: finProfile.vat_registered ? VAT_RATE : 0,
      invoices: invoicesDemo.filter((i) => i.org_id === ORG_A).map((i) => ({ id: i.id, number: i.number, kind: i.kind, source: i.source,
        subtotal: i.subtotal, vat_amount: i.vat_amount, total: i.total, issued_at: i.issued_at, status: i.status })) };
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
