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
  LOGIN: "تسجيل دخول", LOGIN_FAILED: "محاولة دخول فاشلة", CHANGE_PASSWORD: "تغيير كلمة المرور",
  CREATE: "إنشاء", UPDATE: "تعديل", ARCHIVE: "أرشفة", RENEW: "تجديد", REMIND: "تذكير يدوي", UPSERT: "ضبط قاعدة",
  ADMIN_CREATE_ORG: "إنشاء منشأة", ADMIN_UPDATE_ORG: "تعديل منشأة",
  ADMIN_SUSPEND_ORG: "تعليق منشأة", ADMIN_REACTIVATE_ORG: "إعادة تفعيل منشأة",
  ADMIN_CHANGE_PLAN: "تغيير الباقة", ADMIN_EXTEND_TRIAL: "تمديد التجربة",
  ADMIN_RECORD_PAYMENT: "تسجيل دفعة", ADMIN_CANCEL_SUBSCRIPTION: "إلغاء اشتراك",
  ADMIN_INVITE_MEMBER: "دعوة عضو", ADMIN_UPDATE_MEMBERSHIP: "تعديل عضوية",
  ADMIN_RESET_PASSWORD: "إعادة تعيين كلمة المرور", ADMIN_DISABLE_USER: "تعطيل مستخدم", ADMIN_ENABLE_USER: "تفعيل مستخدم",
  ADMIN_TEAM_ADD: "إضافة عضو للفريق", ADMIN_TEAM_ROLE: "تغيير دور في الفريق",
  ADMIN_INVOICE_VOID: "إلغاء فاتورة بإشعار دائن", ADMIN_EXPENSE_ADD: "تسجيل مصروف", ADMIN_EXPENSE_UPDATE: "تعديل مصروف",
  ADMIN_EXPENSE_DELETE: "حذف مصروف", ADMIN_FINANCE_PROFILE: "تعديل بيانات حصيف الضريبية",
  ADMIN_ROLE_CREATE: "إنشاء دور إداري", ADMIN_ROLE_UPDATE: "تعديل صلاحيات دور", ADMIN_ROLE_DELETE: "حذف دور إداري",
  DPIA_ADD: "تقييم أثر جديد", DPIA_EDIT: "تعديل تقييم أثر", DPIA_STATUS: "تغيير حالة تقييم أثر", DPIA_DELETE: "حذف تقييم أثر",
  GROUP_ENTITY_ADD: "إضافة منشأة للمجموعة", GROUP_ENTITY_CREATED: "إنشاء منشأة تابعة",
  BOARD_REPORT_SAVE: "حفظ تقرير المجلس", ALERT_RECIPIENT: "ضبط مستلم التنبيهات", ADMIN_TRIAL_STATUS: "متابعة طلب تجربة",
};

const AUDIT_KEY_LABEL: Record<string, string> = {
  reason: "السبب", canceled_alerts: "تنبيهات أُلغيت", days: "الأيام", ends_at: "تنتهي في",
  amount_sar: "المبلغ", cycle: "الدورة", reference: "المرجع", email: "البريد", admin: "المدير",
  role: "الدور", is_active: "الحالة", name: "الاسم", cr_number: "السجل التجاري", plan: "الباقة",
  entity_legal_type: "الكيان", industry_type: "القطاع", commercial_size: "الحجم", recipients: "المستلمون",
  title: "العنوان", expiry_date: "الانتهاء", renewed_from: "تجديد لـ", code: "الرمز", credit_note: "الإشعار الدائن", vendor: "المورّد", category: "البند",
};
const CYCLE_LABEL: Record<string, string> = { MONTHLY: "شهرية", YEARLY: "سنوية" };

function auditValue(action: string, key: string, v: unknown): string {
  if (typeof v === "boolean") return key === "is_active" ? (v ? "فعّال" : "معطّل") : v ? "نعم" : "لا";
  const s = String(v);
  if (key === "role" || key === "from" || key === "to") {
    if (action === "ADMIN_CHANGE_PLAN") return PLAN_LABEL[s] ?? s;
    return PLATFORM_ROLE_LABEL[s] ?? ORG_ROLE_LABEL[s] ?? s;
  }
  if (key === "plan") return PLAN_LABEL[s] ?? s;
  if (key === "cycle") return CYCLE_LABEL[s] ?? s;
  if (key === "entity_legal_type") return LEGAL_TYPE_LABEL[s] ?? s;
  if (key === "commercial_size") return SIZE_LABEL[s] ?? s;
  if (key === "amount_sar") return `${Number(s).toLocaleString("en-US")} ريال`;
  if (key === "ends_at" || key === "expiry_date") return s.slice(0, 10);
  if (key === "days") return countDays(Number(s));
  return s;
}

/** وصف عربي مقروء لتفاصيل حدث في سجل التدقيق. */
export function auditSummary(action: string, changes: Record<string, unknown> | null): string {
  if (!changes) return "";
  const c = { ...changes };
  const parts: string[] = [];
  if (typeof c.role_name === "string") { c.role = c.role_name; delete c.role_name; }   // مسمى الدور المخصص بدل رمزه
  if (Array.isArray(c.permissions)) {
    parts.push(`${c.permissions.length} صلاحية${Array.isArray(c.before) ? ` (كانت ${c.before.length})` : ""}`);
    delete c.permissions; delete c.before;
  }
  if (c.name && c.code) delete c.code;
  if ("from" in c || "to" in c) {
    const from = c.from ? auditValue(action, "from", c.from) : null;
    const to = c.to ? auditValue(action, "to", c.to) : null;
    if (action === "ADMIN_TEAM_ROLE" && !to) parts.push(`أُزيل من الفريق${from ? ` (كان: ${from})` : ""}`);
    else parts.push(from ? `من ${from} إلى ${to ?? "—"}` : `إلى ${to}`);
    delete c.from; delete c.to;
  }
  for (const [k, v] of Object.entries(c)) {
    if (v === null || v === undefined || v === "" || typeof v === "object") continue;
    parts.push(`${AUDIT_KEY_LABEL[k] ?? k}: ${auditValue(action, k, v)}`);
  }
  return parts.slice(0, 5).join("، ");
}

// ---------- الحوكمة والالتزامات والمكتبة
export const BODY_TYPE_LABEL: Record<string, string> = {
  OWNER: "المالك", GENERAL_ASSEMBLY: "الجمعية العامة", PARTNERS_ASSEMBLY: "جمعية الشركاء", BOARD: "مجلس الإدارة",
  MANAGER: "المدير / المديرون", EXECUTIVE_MANAGEMENT: "الإدارة التنفيذية", AUDIT_COMMITTEE: "لجنة المراجعة",
  NOMINATION_REMUNERATION_COMMITTEE: "لجنة الترشيحات والمكافآت", RISK_COMMITTEE: "لجنة المخاطر",
  EXECUTIVE_COMMITTEE: "اللجنة التنفيذية", OTHER_COMMITTEE: "لجنة أخرى", COMPANY_SECRETARY: "أمين السر",
  INTERNAL_AUDIT: "المراجعة الداخلية", COMPLIANCE_FUNCTION: "إدارة الالتزام", DPO: "مسؤول حماية البيانات",
};
export const POSITION_LABEL: Record<string, string> = {
  CHAIR: "رئيس", VICE_CHAIR: "نائب الرئيس", MEMBER: "عضو", SECRETARY: "أمين السر", HEAD: "المسؤول",
};
export const GOV_DOMAIN_LABEL: Record<string, string> = {
  STRUCTURE: "الهيكل", BOARD: "مجلس الإدارة", ASSEMBLY: "الجمعيات", AUDIT: "اللجان والمراجعة",
  DISCLOSURE: "الإفصاح", POLICIES: "السياسات", PDPL: "حماية البيانات",
};
export const OBLIGATION_DOMAIN_LABEL: Record<string, string> = {
  COMMERCIAL: "تجاري", MUNICIPAL: "بلدي", LABOR: "العمل والموارد البشرية", TAX: "الزكاة والضريبة",
  SAFETY: "السلامة", PDPL: "حماية البيانات الشخصية", GOVERNANCE: "الحوكمة", AML: "مكافحة غسل الأموال",
  INSURANCE: "التأمين",
};
export const OBLIGATION_KIND_LABEL: Record<string, string> = {
  LICENSE: "ترخيص", REGISTRATION: "تسجيل", FILING: "إيداع / إقرار", POLICY: "سياسة", PRACTICE: "إجراء",
};
export const FREQUENCY_LABEL: Record<string, string> = {
  ONCE: "مرة واحدة", ANNUAL: "سنوي", RENEWAL: "يُجدَّد", EVENT: "عند حدوث تغيير", CONTINUOUS: "مستمر",
};
export const OBLIGATION_STATUS_LABEL: Record<string, string> = {
  PENDING: "لم يُستوفَ بعد", IN_PLACE: "مستوفى", NOT_APPLICABLE: "لا ينطبق", AT_RISK: "منتهٍ — يحتاج تجديد",
};
export const LIBRARY_KIND_LABEL: Record<string, string> = {
  TEMPLATE: "نموذج", LAW: "نظام / مصدر رسمي", GUIDE: "دليل", FILE: "ملف",
};
export const LIBRARY_CATEGORY_LABEL: Record<string, string> = {
  GOVERNANCE: "الحوكمة", POLICIES: "السياسات", PDPL: "حماية البيانات", LABOR: "العمل", TAX: "الزكاة والضريبة",
  COMMERCIAL: "تجاري", SAFETY: "السلامة", AML: "مكافحة غسل الأموال",
};
export const POLICY_TYPE_LABEL: Record<string, string> = {
  PRIVACY_POLICY: "سياسة الخصوصية", CONFLICT_OF_INTEREST: "تعارض المصالح", WHISTLEBLOWING: "الإبلاغ عن المخالفات",
  CODE_OF_CONDUCT: "ميثاق السلوك", DATA_RETENTION: "الاحتفاظ بالبيانات", INFOSEC: "أمن المعلومات",
  BREACH_RESPONSE: "الاستجابة للتسرب", RELATED_PARTIES: "الأطراف ذات العلاقة", BOARD_CHARTER: "لائحة المجلس",
  AUDIT_COMMITTEE_CHARTER: "لائحة لجنة المراجعة", DISCLOSURE: "الإفصاح", DOA: "مصفوفة الصلاحيات",
  RISK_MANAGEMENT: "إدارة المخاطر", AML: "مكافحة غسل الأموال", WORK_REGULATION: "لائحة تنظيم العمل",
  HEALTH_SAFETY: "السلامة والصحة المهنية", OTHER: "أخرى",
};
export const POLICY_STATUS_LABEL: Record<string, string> = {
  DRAFT: "مسودة", ACTIVE: "معتمدة", OBSOLETE: "ملغاة", NEEDS_REVIEW: "تقترب المراجعة", OVERDUE_REVIEW: "فات موعد المراجعة",
};
export const LEVEL_LABEL: Record<string, string> = { MANDATORY: "إلزامي", RECOMMENDED: "ممارسة فضلى" };
export const REVIEW_BADGE = "مسودة — قيد المراجعة";

export function fileSize(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} ك.ب`;
  return `${(bytes / 1024 / 1024).toFixed(1)} م.ب`;
}

// ---------- حماية البيانات
export const DATA_SUBJECTS_LABEL: Record<string, string> = {
  EMPLOYEES: "الموظفون", CUSTOMERS: "العملاء", VENDORS: "الموردون", APPLICANTS: "المتقدمون للوظائف", VISITORS: "الزوار", OTHER: "أخرى",
};
export const LEGAL_BASIS_LABEL: Record<string, string> = {
  CONSENT: "الموافقة", CONTRACTUAL: "تنفيذ عقد", LEGAL_OBLIGATION: "التزام نظامي", VITAL_INTEREST: "مصلحة حيوية",
  PUBLIC_INTEREST: "مصلحة عامة", LEGITIMATE_INTEREST: "مصلحة مشروعة",
};
export const STORAGE_LABEL: Record<string, string> = {
  SAUDI_LOCAL_CLOUD: "سحابة داخل المملكة", ON_PREMISE: "خوادم المنشأة", FOREIGN_CLOUD: "سحابة خارج المملكة",
};
export const DSR_TYPE_LABEL: Record<string, string> = {
  ACCESS: "الاطلاع على البيانات", COPY: "نسخة من البيانات", CORRECTION: "تصحيح", DESTRUCTION: "إتلاف",
  WITHDRAW_CONSENT: "سحب الموافقة", OBJECTION: "اعتراض", OTHER: "أخرى",
};
export const DSR_STATUS_LABEL: Record<string, string> = { OPEN: "جديد", IN_PROGRESS: "قيد المعالجة", COMPLETED: "نُفّذ", REJECTED: "رُفض" };
export const CHANNEL_LABEL: Record<string, string> = { EMAIL: "بريد", PHONE: "هاتف", WEBSITE: "الموقع", IN_PERSON: "حضورياً", OTHER: "أخرى" };
export const INCIDENT_STATUS_LABEL: Record<string, string> = { OPEN: "مفتوحة", CONTAINED: "احتُويت", REPORTED: "أُبلغ عنها", CLOSED: "مغلقة" };
export const SEVERITY_LABEL: Record<string, string> = { LOW: "منخفضة", MEDIUM: "متوسطة", HIGH: "عالية" };

// ---------- الاستشارات القانونية
export const CONSULT_STATUS_LABEL: Record<string, string> = {
  REQUESTED: "بانتظار التأكيد", CONFIRMED: "مؤكدة", COMPLETED: "مكتملة", CANCELED: "ملغاة",
};
export const CONSULT_MODE_LABEL: Record<string, string> = { VIDEO: "مكالمة مرئية", PHONE: "مكالمة هاتفية", IN_PERSON: "حضورياً" };
export const PAYMENT_STATUS_LABEL: Record<string, string> = { UNPAID: "بانتظار الدفع", PAID: "مدفوعة", REFUNDED: "مستردة" };
export function minutesLabel(m: number): string {
  if (m === 30) return "نصف ساعة";
  if (m === 60) return "ساعة";
  if (m === 90) return "ساعة ونصف";
  if (m === 120) return "ساعتان";
  if (m % 60 === 0) return `${m / 60} ساعات`;
  return `${m} دقيقة`;
}
export const sarFmt = (n: number) => `${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ريال`;

// ---------- تقييم الأثر، المجموعات، التقارير، التنبيهات
export const RISK4_LABEL: Record<string, string> = { LOW: "منخفض", MEDIUM: "متوسط", HIGH: "عالٍ", CRITICAL: "حرج" };
export const DPIA_STATUS_LABEL: Record<string, string> = { IN_PROGRESS: "قيد الإعداد", COMPLETED: "مكتمل — بانتظار الاعتماد", APPROVED: "معتمد" };
export const MITIGATION_STATUS_LABEL: Record<string, string> = { PLANNED: "مخطط", IN_PROGRESS: "قيد التنفيذ", DONE: "منفّذ" };
export const ENTITY_RELATION_LABEL: Record<string, string> = { SUBSIDIARY: "شركة تابعة", BRANCH: "فرع", AFFILIATE: "شركة شقيقة" };
export const RESOLUTION_TYPE_LABEL: Record<string, string> = {
  ORDINARY_ASSEMBLY: "جمعية عامة عادية", EXTRAORDINARY_ASSEMBLY: "جمعية عامة غير عادية", BOARD_DECISION: "قرار مجلس الإدارة",
  PARTNERS_DECISION: "قرار الشركاء", MANAGER_DECISION: "قرار المدير",
};
export const DISPATCH_STATUS_LABEL: Record<string, string> = {
  QUEUED: "مجدول", SENDING: "قيد الإرسال", SENT: "أُرسل", DELIVERED: "وصل", READ: "قُرئ", FAILED: "فشل",
  SKIPPED: "تُخطّي", CANCELED: "أُلغي",
};
export const ALERT_CHANNEL_LABEL: Record<string, string> = { WHATSAPP: "واتساب", EMAIL: "بريد إلكتروني" };
export const PRIORITY_LABEL: Record<string, string> = { CRITICAL: "حرجة", HIGH: "عالية", MEDIUM: "متوسطة", LOW: "منخفضة" };
export const TRIAL_STATUS_LABEL: Record<string, string> = { NEW: "جديد", CONTACTED: "تم التواصل", CONVERTED: "أصبح عميلاً", REJECTED: "غير مناسب" };
export const INTEREST_LABEL: Record<string, string> = {
  LICENSES: "التراخيص والتنبيهات", GOVERNANCE: "الحوكمة والهيكل", PDPL: "حماية البيانات", POLICIES: "السياسات والنماذج",
  LEGAL: "استشارة محامٍ", GROUP: "عدة منشآت أو فروع",
};
