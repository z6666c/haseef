/**
 * نصوص قوالب واتساب المعتمدة (المقدمة لـ Meta) — مطابقة لـ docs/whatsapp-templates.md
 * وللمتغيرات الستة التي يرسلها الخادم (apps/api/haseef/domain/alerts.py) بالترتيب نفسه.
 * تُستخدم لمعاينة الرسالة في الواجهة كما ستصل للمستلم.
 */
import { duePhrase, formatDate } from "./format.ts";

export type TemplateKey = "haseef_license_expiring" | "haseef_license_expired" | "haseef_policy_review_due";

export const WA_TEMPLATES: Record<TemplateKey, { title: string; body: string; footer: string }> = {
  haseef_license_expiring: {
    title: "قرب انتهاء ترخيص أو وثيقة",
    body: "مرحباً {{1}}،\nتنبيه من حصيف: صلاحية «{{2}}» لمنشأة {{3}} تنتهي {{4}}، بتاريخ {{5}}.\nجدّد الوثيقة قبل موعدها لتجنب الغرامات وتعطل الخدمات، ثم حدّث تاريخها في حصيف.\nللتجديد: {{6}}\nفريق حصيف",
    footer: "رسالة خدمية من منصة حصيف",
  },
  haseef_license_expired: {
    title: "انتهاء ترخيص أو وثيقة",
    body: "مرحباً {{1}}،\nتنبيه عاجل من حصيف: انتهت صلاحية «{{2}}» لمنشأة {{3}}، وكان انتهاؤها {{4}} بتاريخ {{5}}.\nالمنشأة معرضة لغرامات أو تعطل خدمات حتى يتم التجديد. جدّد الآن ثم حدّث التاريخ في حصيف.\nللتجديد: {{6}}\nفريق حصيف",
    footer: "رسالة خدمية من منصة حصيف",
  },
  haseef_policy_review_due: {
    title: "موعد مراجعة سياسة داخلية",
    body: "مرحباً {{1}}،\nتذكير من حصيف: «{{2}}» في منشأة {{3}} مستحقة المراجعة الدورية {{4}}، بتاريخ {{5}}.\nراجع السياسة وحدّثها أو أعد اعتمادها من صفحة السياسات.\nالرابط: {{6}}\nفريق حصيف",
    footer: "رسالة خدمية من منصة حصيف",
  },
};

/** القالب الذي يختاره الخادم: السياسات ← مراجعة، وغيرها ← قرب الانتهاء أو الانتهاء حسب الأيام المتبقية. */
export function templateFor(targetType: string, daysLeft: number): TemplateKey {
  if (targetType === "POLICY") return "haseef_policy_review_due";
  return daysLeft < 0 ? "haseef_license_expired" : "haseef_license_expiring";
}

export interface AlertMessageInput {
  recipient: string; title: string; orgName: string; dueDate: string; daysLeft: number; link: string;
}

/** المتغيرات الستة بترتيب الخادم: الاسم، العنصر، المنشأة، العبارة الزمنية، التاريخ، الرابط. */
export function templateVars(x: AlertMessageInput): string[] {
  return [x.recipient, x.title, x.orgName, duePhrase(x.daysLeft), formatDate(x.dueDate), x.link];
}

export function renderTemplate(key: TemplateKey, vars: string[]): string {
  return WA_TEMPLATES[key].body.replace(/\{\{(\d)\}\}/g, (_, n: string) => vars[Number(n) - 1] ?? "");
}
