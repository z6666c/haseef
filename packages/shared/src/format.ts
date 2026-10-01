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

export const PLAN_LABEL: Record<string, string> = {
  ESSENTIAL: "باقة الأساس",
  PROFESSIONAL_GRC: "باقة الحوكمة والنمو",
  ENTERPRISE: "باقة كبار العملاء",
};
