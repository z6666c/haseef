/**
 * تقييم الأثر على حماية البيانات — منفذ مطابق لـ apps/api/haseef/domain/dpia.py
 * (يُستخدم للمعاينة الفورية في الواجهة ولنسخة العرض؛ الخادم هو المرجع).
 */
import type { DpiaMitigation, DpiaQuestion, RiskLevel4 } from "./api.ts";

export function dpiaLevel(score: number): RiskLevel4 {
  if (score >= 60) return "CRITICAL";
  if (score >= 40) return "HIGH";
  if (score >= 20) return "MEDIUM";
  return "LOW";
}

/** تقريب مطابق لـ round في بايثون (تقريب المصرفي عند .5). */
function pyRound(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}

export function dpiaSuggest(questions: DpiaQuestion[], answers: Record<string, boolean>): DpiaMitigation[] {
  return questions.filter((q) => answers[q.key]).map((q) => ({ code: q.key, text: q.mitigation, status: "PLANNED", owner: null }));
}

export function dpiaAssess(questions: DpiaQuestion[], answers: Record<string, boolean>, mitigations: DpiaMitigation[] = []) {
  const max = questions.reduce((s, q) => s + q.weight, 0);
  const yes = questions.filter((q) => answers[q.key]);
  const raw = yes.reduce((s, q) => s + q.weight, 0);
  const score = pyRound((raw * 100) / max);
  const done = new Set(mitigations.filter((m) => m.status === "DONE").map((m) => m.code));
  const pending = new Set(mitigations.filter((m) => m.status !== "DONE").map((m) => m.code));
  const reduced = yes.filter((q) => done.has(q.key) && !pending.has(q.key)).reduce((s, q) => s + (q.weight * 2) / 3, 0);
  const residual = pyRound(((raw - reduced) * 100) / max);
  const triggers = yes.filter((q) => q.trigger).map((q) => q.key);
  return {
    score, level: dpiaLevel(score), required: triggers.length > 0, triggers,
    residual_score: residual, residual_level: dpiaLevel(residual),
    open_mitigations: mitigations.filter((m) => m.status !== "DONE").length,
  };
}
