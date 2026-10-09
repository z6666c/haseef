/** جدول الجزاءات وفق لائحة تنظيم العمل النموذجية (منطق نقي). مطابق لـ apps/api/haseef/domain/penalties.py. */

export type LateBracket = "LATE_15" | "LATE_30" | "LATE_60" | "LATE_OVER";
export type AbsBracket = "ABS_1" | "ABS_2_6" | "ABS_7_10" | "ABS_11_14" | "ABS_15";
export type Bracket = LateBracket | AbsBracket;
type P = "WARNING" | "TERMINATE_ART80" | "TERMINATE_WITH_AWARD" | number;
const W = "WARNING", T80 = "TERMINATE_ART80", TAW = "TERMINATE_WITH_AWARD";

export const LATE_TABLE: Record<LateBracket, { normal: P[]; disrupted: P[] }> = {
  LATE_15: { normal: [W, 0.05, 0.10, 0.20], disrupted: [W, 0.15, 0.25, 0.50] },
  LATE_30: { normal: [0.10, 0.15, 0.25, 0.50], disrupted: [0.25, 0.50, 0.75, 1] },
  LATE_60: { normal: [0.25, 0.50, 0.75, 1], disrupted: [0.30, 0.50, 1, 2] },
  LATE_OVER: { normal: [W, 1, 2, 3], disrupted: [W, 1, 2, 3] },
};
export const ABSENCE_TABLE: Record<AbsBracket, P[]> = {
  ABS_1: [2, 3, 4, 5], ABS_2_6: [2, 3, 4, 5], ABS_7_10: [4, 5, 5, TAW], ABS_11_14: [5, 5, T80, T80], ABS_15: [T80, T80, T80, T80],
};
export const BRACKET_LABEL: Record<Bracket, string> = {
  LATE_15: "تأخر حتى 15 دقيقة", LATE_30: "تأخر من 16 إلى 30 دقيقة", LATE_60: "تأخر من 31 إلى 60 دقيقة", LATE_OVER: "تأخر أكثر من ساعة",
  ABS_1: "غياب يوم دون إذن أو عذر", ABS_2_6: "غياب من يومين إلى 6 أيام متصلة", ABS_7_10: "غياب من 7 إلى 10 أيام متصلة",
  ABS_11_14: "غياب من 11 إلى 14 يوماً متصلة", ABS_15: "غياب أكثر من 15 يوماً متصلة",
};
const ORDINAL: Record<number, string> = { 1: "الأولى", 2: "الثانية", 3: "الثالثة", 4: "الرابعة" };

export const lateBracket = (m: number): LateBracket | null => (m <= 0 ? null : m <= 15 ? "LATE_15" : m <= 30 ? "LATE_30" : m <= 60 ? "LATE_60" : "LATE_OVER");
export const absenceBracket = (d: number): AbsBracket | null =>
  d <= 0 ? null : d === 1 ? "ABS_1" : d <= 6 ? "ABS_2_6" : d <= 10 ? "ABS_7_10" : d <= 14 ? "ABS_11_14" : "ABS_15";

export function penaltyOf(bracket: Bracket, occurrence: number, disrupted = false): P {
  const i = Math.min(Math.max(occurrence, 1), 4) - 1;
  return bracket in LATE_TABLE ? LATE_TABLE[bracket as LateBracket][disrupted ? "disrupted" : "normal"][i] : ABSENCE_TABLE[bracket as AbsBracket][i];
}

export function describePenalty(p: P): string {
  if (p === W) return "إنذار كتابي";
  if (p === T80) return "يحق الفصل وفق المادة 80 دون مكافأة بعد إنذار كتابي — قرار إداري خارج حصيف";
  if (p === TAW) return "يحق الفصل مع المكافأة إن لم يتجاوز مجموع الغياب 30 يوماً — قرار إداري خارج حصيف";
  if (p < 1) return `حسم ${Math.round(p * 100)}% من الأجر اليومي`;
  return p === 1 ? "حسم أجر يوم" : p === 2 ? "حسم أجر يومين" : `حسم أجر ${p} أيام`;
}

export interface PenaltySuggestion { bracket: Bracket; bracket_label: string; occurrence: number; occurrence_label: string; label: string;
  nature: "PENALTY" | "WARNING" | "ACTION"; amount: number; days_equiv?: number; alt_disrupted?: { nature: string; label: string; amount: number } }

export function suggestPenalty(bracket: Bracket, occurrence: number, dwage: number, disrupted = false): PenaltySuggestion {
  const p = penaltyOf(bracket, occurrence, disrupted);
  const base = { bracket, bracket_label: BRACKET_LABEL[bracket], occurrence, occurrence_label: `المرة ${ORDINAL[occurrence] ?? `رقم ${occurrence}`}`, label: describePenalty(p) };
  if (p === W) return { ...base, nature: "WARNING", amount: 0 };
  if (typeof p !== "number") return { ...base, nature: "ACTION", amount: 0 };
  return { ...base, nature: "PENALTY", amount: Math.round(dwage * p * 100) / 100, days_equiv: p };
}
