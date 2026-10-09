/** تقويم الزكاة والضريبة — مطابق لـ apps/api/haseef/domain/tax.py. التواريخ بصيغة YYYY-MM-DD. */
export type TaxKind = "VAT_RETURN" | "WHT_RETURN" | "ZAKAT_RETURN";
export const TAX_LABEL: Record<TaxKind, string> = {
  VAT_RETURN: "إقرار ضريبة القيمة المضافة", WHT_RETURN: "إقرار ضريبة الاستقطاع", ZAKAT_RETURN: "الإقرار الزكوي",
};
export const TAX_HINT: Record<TaxKind, string> = {
  VAT_RETURN: "حتى آخر يوم من الشهر التالي لنهاية الفترة",
  WHT_RETURN: "خلال أول عشرة أيام من الشهر التالي",
  ZAKAT_RETURN: "خلال 120 يوماً من نهاية السنة المالية",
};

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const parts = (d: string) => d.split("-").map(Number) as [number, number, number];
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const monthEnd = (d: string) => { const [y, m] = parts(d); return iso(y, m, daysIn(y, m)); };
export function addMonths1(d: string, n: number): string {
  const [y, m] = parts(d); const t = y * 12 + m - 1 + n; return iso(Math.floor(t / 12), (t % 12) + 1, 1);
}
export function addDaysIso(d: string, n: number): string {
  const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10);
}

export function vatPeriods(today: string, frequency: "MONTHLY" | "QUARTERLY"): [string, string][] {
  const [y, m] = parts(today);
  if (frequency === "MONTHLY") { const cur = iso(y, m, 1); return [addMonths1(cur, -1), cur].map((s) => [s, monthEnd(s)]); }
  const q = iso(y, Math.floor((m - 1) / 3) * 3 + 1, 1);
  return [addMonths1(q, -3), q].map((s) => [s, monthEnd(addMonths1(s, 2))]);
}
export const vatDue = (end: string) => monthEnd(addDaysIso(end, 1));
export const whtPeriods = (today: string): [string, string][] => { const [y, m] = parts(today); const cur = iso(y, m, 1); return [addMonths1(cur, -1), cur].map((s) => [s, monthEnd(s)]); };
export const whtDue = (end: string) => `${addDaysIso(end, 1).slice(0, 8)}10`;
export function fiscalYears(today: string, endMonth: number): [string, string][] {
  const [y] = parts(today);
  const endThis = monthEnd(iso(y, endMonth, 1));
  const cur = today <= endThis ? endThis : monthEnd(iso(y + 1, endMonth, 1));
  const prev = monthEnd(iso(parts(cur)[0] - 1, endMonth, 1));
  const start = (e: string) => addMonths1(`${e.slice(0, 8)}01`, -11);
  return [[start(prev), prev], [start(cur), cur]];
}
export const zakatDue = (fyEnd: string) => addDaysIso(fyEnd, 120);

export function taxPlan(today: string, p: { vat_registered: boolean; vat_frequency: "MONTHLY" | "QUARTERLY"; withholding_applies: boolean; zakat_applies: boolean; fiscal_year_end_month: number }) {
  const out: { kind: TaxKind; start: string; end: string; due: string }[] = [];
  if (p.vat_registered) vatPeriods(today, p.vat_frequency).forEach(([s, e]) => out.push({ kind: "VAT_RETURN", start: s, end: e, due: vatDue(e) }));
  if (p.withholding_applies) whtPeriods(today).forEach(([s, e]) => out.push({ kind: "WHT_RETURN", start: s, end: e, due: whtDue(e) }));
  if (p.zakat_applies) fiscalYears(today, p.fiscal_year_end_month).forEach(([s, e]) => out.push({ kind: "ZAKAT_RETURN", start: s, end: e, due: zakatDue(e) }));
  return out;
}

export function taxPeriodLabel(kind: TaxKind, start: string, end: string): string {
  const mm = (d: string) => d.slice(5, 7), yy = (d: string) => d.slice(0, 4);
  if (kind === "ZAKAT_RETURN") return `السنة المالية المنتهية ${mm(end)}/${yy(end)}`;
  if (start.slice(0, 7) === end.slice(0, 7)) return `شهر ${mm(start)}/${yy(start)}`;
  return `الربع ${mm(start)}–${mm(end)}/${yy(end)}`;
}
