// صياغة عربية مطابقة لـ apps/api/haseef/domain/arabic.py — الواجهة والرسائل تقول الشيء نفسه.
import type { ComplianceCategory, ItemStatus, Pillar, RiskLevel } from "./types.ts";

export function countDays(n: number): string {
  if (n < 0) throw new RangeError("countDays expects a non-negative number");
  if (n === 1) return "يوم واحد";
  if (n === 2) return "يومين";
  const tail = n % 100;
  if (n >= 100 && tail <= 2) return `${n} يوم`;
  if (tail >= 3 && tail <= 10) return `${n} أيام`;
  return `${n} يوماً`;
}

/** "اليوم" / "خلال 3 أيام" / "منذ يومين" */
export function duePhrase(daysLeft: number): string {
  if (daysLeft === 0) return "اليوم";
  return daysLeft > 0 ? `خلال ${countDays(daysLeft)}` : `منذ ${countDays(-daysLeft)}`;
}

/** عبارة الحالة كاملة، مثل: "تنتهي خلال 5 أيام" أو "انتهت منذ يومين" */
export function expiryLine(daysLeft: number): string {
  if (daysLeft < 0) return `انتهت ${duePhrase(daysLeft)}`;
  if (daysLeft === 0) return "تنتهي اليوم";
  return `تنتهي ${duePhrase(daysLeft)}`;
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export const CATEGORY_LABEL: Record<ComplianceCategory, string> = {
  COMMERCIAL_REG: "السجل التجاري",
  BALADY: "رخصة بلدي",
  CHI_INSURANCE: "التأمين الطبي",
  GOSI: "التأمينات الاجتماعية",
  QIWA_NITAQAT: "نطاقات (قوى)",
  WPS: "حماية الأجور",
  ZATCA: "الزكاة والضريبة",
  CIVIL_DEFENSE: "الدفاع المدني",
  CHAMBER: "الغرفة التجارية",
  OTHER: "أخرى",
};

export const STATUS_LABEL: Record<ItemStatus, string> = {
  ACTIVE: "ساري",
  EXPIRING_SOON: "قارب على الانتهاء",
  EXPIRED: "منتهٍ",
};

export const RISK_LABEL: Record<RiskLevel, string> = {
  CRITICAL: "حرج",
  HIGH: "عالٍ",
  MEDIUM: "متوسط",
};

export const PILLAR_LABEL: Record<Pillar, string> = {
  OPERATIONAL: "الامتثال التشغيلي",
  GOVERNANCE_PDPL: "الحوكمة وحماية البيانات",
  CONTRACTS: "العقود واللوائح",
};

/** دليل الهوية: 85% فما فوق زمردي (منشأة محصنة)، دون ذلك تنبيه، ودون 50% خطر. */
export function scoreTone(score: number | null): "good" | "warn" | "bad" | "none" {
  if (score === null) return "none";
  if (score >= 85) return "good";
  if (score >= 50) return "warn";
  return "bad";
}

export const RESOLUTION_STATUS_LABEL: Record<string, string> = {
  DRAFTED: "مسودة", CIRCULATED: "قيد التوقيع", SIGNED: "موقّع", ARCHIVED: "مؤرشف",
};

export const PLAN_LABEL: Record<string, string> = {
  ESSENTIAL: "باقة الأساس",
  PROFESSIONAL_GRC: "باقة الحوكمة والنمو",
  ENTERPRISE: "باقة كبار العملاء",
};

export const PLATFORM_ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "المدير العام", SUPPORT: "الدعم الفني", BILLING: "المحاسبة",
};

export const ORG_ROLE_LABEL: Record<string, string> = {
  ORG_ADMIN: "مدير المنشأة", COMPLIANCE_OFFICER: "مسؤول الامتثال", DPO: "مسؤول حماية البيانات",
  VIEWER: "اطلاع فقط", EXTERNAL_ADVISOR: "مستشار خارجي",
};

export const LEGAL_TYPE_LABEL: Record<string, string> = {
  LLC: "شركة ذات مسؤولية محدودة", SOLE_PROPRIETORSHIP: "مؤسسة فردية", CLOSED_JOINT_STOCK: "مساهمة مقفلة",
  SIMPLIFIED_JOINT_STOCK: "مساهمة مبسطة", PUBLIC_JOINT_STOCK: "مساهمة عامة", BRANCH_OF_FOREIGN: "فرع شركة أجنبية",
};

export const SIZE_LABEL: Record<string, string> = { MICRO: "متناهية الصغر", SMALL: "صغيرة", MEDIUM: "متوسطة" };

export const BILLING_STATUS_LABEL: Record<string, string> = {
  TRIAL: "تجريبي", ACTIVE: "فعّال", PAST_DUE: "متأخر السداد", CANCELED: "ملغى", EXPIRED: "منتهٍ",
};

export const BILLING_EVENT_LABEL: Record<string, string> = {
  TRIAL_STARTED: "بدء التجربة", TRIAL_EXTENDED: "تمديد التجربة", PAYMENT: "دفعة",
  PLAN_CHANGED: "تغيير الباقة", CANCELED: "إلغاء", REACTIVATED: "إعادة تفعيل",
};

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  LOGIN: "تسجيل دخول", CHANGE_PASSWORD: "تغيير كلمة المرور",
  CREATE: "إنشاء", UPDATE: "تعديل", ARCHIVE: "أرشفة", RENEW: "تجديد", REMIND: "تذكير يدوي", UPSERT: "ضبط قاعدة",
  ADMIN_CREATE_ORG: "إنشاء منشأة", ADMIN_UPDATE_ORG: "تعديل منشأة",
  ADMIN_SUSPEND_ORG: "تعليق منشأة", ADMIN_REACTIVATE_ORG: "إعادة تفعيل منشأة",
  ADMIN_CHANGE_PLAN: "تغيير الباقة", ADMIN_EXTEND_TRIAL: "تمديد التجربة",
  ADMIN_RECORD_PAYMENT: "تسجيل دفعة", ADMIN_CANCEL_SUBSCRIPTION: "إلغاء اشتراك",
  ADMIN_INVITE_MEMBER: "دعوة عضو", ADMIN_UPDATE_MEMBERSHIP: "تعديل عضوية",
  ADMIN_RESET_PASSWORD: "إعادة تعيين كلمة المرور", ADMIN_DISABLE_USER: "تعطيل مستخدم", ADMIN_ENABLE_USER: "تفعيل مستخدم",
  ADMIN_TEAM_ADD: "إضافة عضو للفريق", ADMIN_TEAM_ROLE: "تغيير دور في الفريق",
};
