/**
 * محرك فحص الهيكل — نسخة TypeScript مطابقة لـ apps/api/haseef/domain/governance_check.py.
 * تُستخدم في نسخة العرض فقط (لا خادم)، ويختبر تطابقها مع نتيجة بايثون المصدّرة في demo-content.json.
 */

export interface CkMember { full_name: string; position: string; is_independent: boolean; is_executive: boolean; term_ends_on: string | null }
export interface CkBody { body_type: string; name: string; members: CkMember[] }
export interface CkStandard {
  code: string; domain: string; title: string; level: string; severity: string;
  applies_legal_types: string[]; rule: Record<string, unknown>;
}
export interface CkContext {
  legal_type: string; size: string | null; profile: Record<string, unknown>; bodies: CkBody[];
  active_policy_types: Set<string>; ropa_count: number; doa_count: number; today: string;   // YYYY-MM-DD
}
export interface CkResult { code: string; status: "PASS" | "FAIL" | "NA"; message: string; level: string; severity: string; title: string; domain: string }

const SEV: Record<string, number> = { critical: 3, high: 2, medium: 1 };

function months(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number), [by, bm, bd] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am) - (bd < ad ? 1 : 0);
}

function evaluate(rule: Record<string, unknown>, c: CkContext): [CkResult["status"], string] {
  const kind = rule.check as string;
  const of = (...types: string[]) => c.bodies.filter((b) => types.includes(b.body_type));
  const board = of("BOARD")[0];
  if (rule.requires_personal_data && c.profile.processes_personal_data === false) return ["NA", "المنشأة لا تعالج بيانات شخصية حسب ملفها."];

  switch (kind) {
    case "body_exists": {
      const found = of(...(rule.types as string[]));
      if (!found.length) return ["FAIL", "لم يُضف هذا الجهاز إلى الهيكل بعد."];
      const need = (rule.min_members as number) ?? 0;
      if (need && !found.some((b) => b.members.length >= need))
        return ["FAIL", `الجهاز موجود لكن لم يُسجَّل فيه ${need === 1 ? "عضو" : `${need} أعضاء`}.`];
      return ["PASS", "موجود في الهيكل."];
    }
    case "body_or_position":
      if (of(...(rule.types as string[])).length) return ["PASS", "موجود في الهيكل."];
      for (const b of of(rule.body as string)) if (b.members.some((m) => m.position === rule.position)) return ["PASS", "محدد ضمن أعضاء الجهاز."];
      return ["FAIL", "لم يُحدَّد بعد."];
    case "board_min_members": {
      if (!board) return ["FAIL", "لا يوجد مجلس إدارة في الهيكل."];
      const n = board.members.length;
      return n >= (rule.min as number) ? ["PASS", `عدد الأعضاء ${n}.`] : ["FAIL", `عدد الأعضاء ${n} والحد الأدنى ${rule.min}.`];
    }
    case "has_position":
      for (const b of of(rule.body as string)) if (b.members.some((m) => m.position === rule.position)) return ["PASS", "محدد."];
      return ["FAIL", "لم يُحدَّد بعد."];
    case "independent_min": {
      if (!board || !board.members.length) return ["FAIL", "لا يوجد مجلس إدارة بأعضاء مسجلين."];
      const n = board.members.length;
      const need = Math.max((rule.min as number) ?? 0, Math.ceil(n * ((rule.ratio as number) ?? 0)));
      const have = board.members.filter((m) => m.is_independent).length;
      return have >= need ? ["PASS", `المستقلون ${have} من ${n}.`] : ["FAIL", `المستقلون ${have} والمطلوب ${need} على الأقل.`];
    }
    case "majority_non_exec": {
      if (!board || !board.members.length) return ["FAIL", "لا يوجد مجلس إدارة بأعضاء مسجلين."];
      const ne = board.members.filter((m) => !m.is_executive).length;
      return ne * 2 > board.members.length ? ["PASS", `غير التنفيذيين ${ne} من ${board.members.length}.`]
        : ["FAIL", `غير التنفيذيين ${ne} فقط من ${board.members.length}.`];
    }
    case "chair_non_exec": {
      const chair = board?.members.find((m) => m.position === "CHAIR");
      if (!chair) return ["FAIL", "لم يُحدَّد رئيس المجلس."];
      return chair.is_executive ? ["FAIL", `الرئيس (${chair.full_name}) مسجل عضواً تنفيذياً.`] : ["PASS", "الرئيس غير تنفيذي."];
    }
    case "committee": {
      const cm = of(rule.type as string)[0];
      if (!cm) return ["FAIL", "اللجنة غير موجودة في الهيكل."];
      if (cm.members.length < (rule.min as number)) return ["FAIL", `أعضاء اللجنة ${cm.members.length} والحد الأدنى ${rule.min}.`];
      if (rule.no_executives && cm.members.some((m) => m.is_executive)) return ["FAIL", "في اللجنة عضو تنفيذي."];
      return ["PASS", `اللجنة مشكلة من ${cm.members.length} أعضاء.`];
    }
    case "terms_valid": {
      const expired = c.bodies.flatMap((b) => b.members).filter((m) => m.term_ends_on && m.term_ends_on < c.today).map((m) => m.full_name);
      return expired.length ? ["FAIL", `انتهت مدة عضوية: ${expired.slice(0, 3).join("، ")}${expired.length > 3 ? "…" : ""}.`]
        : ["PASS", "لا توجد عضويات منتهية."];
    }
    case "profile_field":
      if (c.size && ((rule.exempt_sizes as string[]) ?? []).includes(c.size)) return ["NA", "المنشأة ضمن الفئات المعفاة حسب حجمها."];
      return c.profile[rule.field as string] ? ["PASS", "مستوفى."] : ["FAIL", "غير مسجل في ملف الحوكمة."];
    case "profile_recent": {
      const v = c.profile[rule.field as string] as string | null;
      if (!v) return ["FAIL", "لم يُسجَّل التاريخ في ملف الحوكمة."];
      const m = months(v.slice(0, 10), c.today);
      return [m <= (rule.months as number) ? "PASS" : "FAIL", `آخر مرة قبل ${m} شهراً.`];
    }
    case "policy_active":
      return c.active_policy_types.has(rule.policy_type as string) ? ["PASS", "سياسة معتمدة وسارية."] : ["FAIL", "لا توجد سياسة معتمدة من هذا النوع."];
    case "ropa_exists":
      return c.ropa_count ? ["PASS", `${c.ropa_count} نشاط معالجة موثق.`] : ["FAIL", "لم يُوثَّق أي نشاط معالجة."];
    case "doa_exists":
      return c.doa_count ? ["PASS", `${c.doa_count} صلاحية معتمدة.`] : ["FAIL", "لا توجد صلاحيات معتمدة."];
  }
  return ["NA", "نوع فحص غير معروف."];
}

export function runCheck(standards: CkStandard[], c: CkContext): { results: CkResult[]; score: number | null } {
  const results: CkResult[] = [];
  for (const s of standards) {
    if (s.applies_legal_types.length && !s.applies_legal_types.includes(c.legal_type)) continue;
    const [status, message] = evaluate(s.rule, c);
    results.push({ code: s.code, status, message, level: s.level, severity: s.severity, title: s.title, domain: s.domain });
  }
  const mand = results.filter((r) => r.level === "MANDATORY" && r.status !== "NA");
  if (!mand.length) return { results, score: null };
  const total = mand.reduce((a, r) => a + SEV[r.severity], 0);
  const earned = mand.filter((r) => r.status === "PASS").reduce((a, r) => a + SEV[r.severity], 0);
  return { results, score: Math.round((1000 * earned) / total) / 10 };
}
