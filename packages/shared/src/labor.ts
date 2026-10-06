/**
 * العمل والموظفين: التأمينات الاجتماعية، حماية الأجور (مُدد)، قوى.
 * مطابق لـ apps/api/haseef/domain/labor.py.
 */
import { round2 } from "./finance.ts";

export type Nationality = "SAUDI" | "NON_SAUDI";
export type GosiSystem = "OLD" | "NEW";
export type LaborTaskKind = "SALARY_PAYMENT" | "GOSI_PAYMENT" | "WPS_UPLOAD";

export interface GosiRate {
  system: "OLD" | "NEW" | "NON_SAUDI"; effective_from: string;
  employee_annuity: number; employer_annuity: number; employee_saned: number; employer_saned: number; employer_hazards: number;
  min_base: number; max_base: number; note?: string | null;
}

/** النسب المعتمدة (تُعدَّل من غرفة العمليات في الإنتاج). */
export const GOSI_RATES: GosiRate[] = [
  { system: "OLD", effective_from: "2014-01-01", employee_annuity: 9, employer_annuity: 9, employee_saned: 0.75, employer_saned: 0.75, employer_hazards: 2, min_base: 1500, max_base: 45000, note: "المشتركون قبل 3 يوليو 2024" },
  ...([["2024-07-03", 9, "النظام الجديد — السنة الأولى"], ["2025-07-01", 9.5, "زيادة تدريجية 0.5%"], ["2026-07-01", 10, "زيادة تدريجية 0.5%"],
    ["2027-07-01", 10.5, "زيادة تدريجية 0.5%"], ["2028-07-01", 11, "النسبة النهائية"]] as const).map(([d, p, note]) => ({
    system: "NEW" as const, effective_from: d, employee_annuity: p, employer_annuity: p, employee_saned: 0.75, employer_saned: 0.75, employer_hazards: 2,
    min_base: 1500, max_base: 45000, note })),
  { system: "NON_SAUDI", effective_from: "2014-01-01", employee_annuity: 0, employer_annuity: 0, employee_saned: 0, employer_saned: 0, employer_hazards: 2, min_base: 1500, max_base: 45000, note: "غير السعوديين: الأخطار المهنية على صاحب العمل فقط" },
];

export const TASK_KINDS: LaborTaskKind[] = ["SALARY_PAYMENT", "GOSI_PAYMENT", "WPS_UPLOAD"];
export const TASK_LABEL: Record<LaborTaskKind, string> = {
  GOSI_PAYMENT: "سداد اشتراكات التأمينات الاجتماعية",
  WPS_UPLOAD: "رفع ملف حماية الأجور في مُدد",
  SALARY_PAYMENT: "صرف الرواتب",
};
export const TASK_WHERE: Record<LaborTaskKind, { name: string; url: string }> = {
  GOSI_PAYMENT: { name: "التأمينات الاجتماعية", url: "https://www.gosi.gov.sa" },
  WPS_UPLOAD: { name: "مُدد", url: "https://mudad.com.sa" },
  SALARY_PAYMENT: { name: "البنك / مُدد", url: "https://mudad.com.sa" },
};
export const NITAQAT_BAND: Record<string, string> = {
  PLATINUM: "بلاتيني", HIGH_GREEN: "أخضر مرتفع", MID_GREEN: "أخضر متوسط", LOW_GREEN: "أخضر منخفض", YELLOW: "أصفر", RED: "أحمر",
};
export const EMP_DOC_LABEL: Record<string, string> = {
  IQAMA: "انتهاء الإقامة", WORK_PERMIT: "انتهاء رخصة العمل", CONTRACT_END: "انتهاء عقد العمل", PROBATION_END: "انتهاء فترة التجربة",
};

export const rateSystem = (n: Nationality, s: GosiSystem) => (n === "NON_SAUDI" ? "NON_SAUDI" : s);

export function pickRate(rates: GosiRate[], system: string, on: string): GosiRate | null {
  return rates.filter((r) => r.system === system && r.effective_from <= on)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;
}

export function contribution(basic: number, housing: number, r: GosiRate) {
  const base = Math.min(Math.max(basic + housing, r.min_base), r.max_base);
  const employeePct = r.employee_annuity + r.employee_saned;
  const employerPct = r.employer_annuity + r.employer_saned + r.employer_hazards;
  const employee = round2((base * employeePct) / 100), employer = round2((base * employerPct) / 100);
  return { base: round2(base), employee, employer, total: round2(employee + employer), employee_pct: employeePct, employer_pct: employerPct };
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
export function addMonthsIso(period: string, n: number): string {
  const t = Number(period.slice(0, 4)) * 12 + Number(period.slice(5, 7)) - 1 + n;
  return iso(Math.floor(t / 12), (t % 12) + 1, 1);
}
function addDays(d: string, n: number): string {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

/** موعد المهمة الشهرية الخاصة بشهر period (YYYY-MM-01). */
export function taskDueDate(kind: LaborTaskKind, period: string, salaryDay = 27): string {
  const y = Number(period.slice(0, 4)), m = Number(period.slice(5, 7));
  if (kind === "SALARY_PAYMENT") return iso(y, m, Math.min(salaryDay, daysIn(y, m)));
  const next = addMonthsIso(period, 1);
  if (kind === "GOSI_PAYMENT") return `${next.slice(0, 8)}15`;
  return addDays(addDays(next, -1), 30);
}

export const periodsToPlan = (today: string) => [addMonthsIso(monthStart(today), -1), monthStart(today)];

/** غرامة تأخير التأمينات: 2% عن كل شهر أو جزء منه. */
export function gosiLatePenalty(amount: number, due: string, paidOn: string): number {
  if (paidOn <= due) return 0;
  const [dy, dm, dd] = due.split("-").map(Number), [py, pm, pd] = paidOn.split("-").map(Number);
  const months = (py - dy) * 12 + pm - dm + (pd > dd ? 1 : 0);
  return round2(amount * 0.02 * Math.max(months, 1));
}

export const wpsFine = (workers: number) => (workers <= 20 ? 500 : workers < 50 ? 1000 : 2000);

export function qiwaIndicators(emps: { nationality: Nationality; qiwa_contract_documented: boolean; gosi_registered: boolean; is_active?: boolean }[]) {
  const a = emps.filter((e) => e.is_active !== false), n = a.length;
  const saudis = a.filter((e) => e.nationality === "SAUDI").length;
  const documented = a.filter((e) => e.qiwa_contract_documented).length;
  const registered = a.filter((e) => e.gosi_registered).length;
  const pct = (x: number) => (n ? Math.round((x * 1000) / n) / 10 : 0);
  return { employees: n, saudis, non_saudis: n - saudis, saudization_pct: pct(saudis), documented, documented_pct: pct(documented),
    gosi_registered: registered, gosi_unregistered: n - registered, wps_fine_if_missed: n ? wpsFine(n) : 0 };
}

/** تحليل CSV للاستيراد: الأعمدة بالعربية أو الإنجليزية. */
const HEAD: Record<string, string> = {
  "الاسم": "full_name", "name": "full_name", "full_name": "full_name",
  "الجنسية": "nationality", "nationality": "nationality",
  "المسمى": "job_title", "المسمى الوظيفي": "job_title", "job_title": "job_title",
  "تاريخ المباشرة": "start_date", "start_date": "start_date",
  "الأساسي": "basic_wage", "الراتب الأساسي": "basic_wage", "basic_wage": "basic_wage",
  "السكن": "housing_allowance", "بدل السكن": "housing_allowance", "housing_allowance": "housing_allowance",
  "انتهاء الإقامة": "iqama_expiry", "iqama_expiry": "iqama_expiry",
  "انتهاء رخصة العمل": "work_permit_expiry", "work_permit_expiry": "work_permit_expiry",
  "انتهاء العقد": "contract_end_date", "contract_end_date": "contract_end_date",
  "موثق في قوى": "qiwa_contract_documented", "qiwa": "qiwa_contract_documented",
  "مسجل في التأمينات": "gosi_registered", "gosi": "gosi_registered",
  "النظام الجديد": "gosi_system", "gosi_system": "gosi_system",
};
const yes = (v: string) => /^(1|نعم|yes|true|y|✓)$/i.test(v.trim());

export function parseEmployeesCsv(textIn: string): { rows: Record<string, unknown>[]; errors: string[] } {
  const lines = textIn.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], errors: ["الملف فارغ أو بلا صف عناوين"] };
  const sep = lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";
  const cols = lines[0].split(sep).map((h) => HEAD[h.trim().toLowerCase()] ?? HEAD[h.trim()] ?? null);
  if (!cols.includes("full_name")) return { rows: [], errors: ["عمود «الاسم» غير موجود"] };
  const rows: Record<string, unknown>[] = [], errors: string[] = [];
  lines.slice(1).forEach((line, i) => {
    const cells = line.split(sep);
    const r: Record<string, unknown> = { nationality: "SAUDI", gosi_system: "OLD", housing_allowance: 0, basic_wage: 0,
      gosi_registered: false, qiwa_contract_documented: false };
    cols.forEach((c, j) => {
      const v = (cells[j] ?? "").trim();
      if (!c || v === "") return;
      if (c === "nationality") r[c] = /سعود|^saudi$/i.test(v) && !/غير/.test(v) ? "SAUDI" : "NON_SAUDI";
      else if (c === "basic_wage" || c === "housing_allowance") r[c] = Number(v.replace(/[^\d.]/g, "")) || 0;
      else if (c === "gosi_registered" || c === "qiwa_contract_documented") r[c] = yes(v);
      else if (c === "gosi_system") r[c] = yes(v) || /new|جديد/i.test(v) ? "NEW" : "OLD";
      else r[c] = v;
    });
    if (!r.start_date) r.start_date = new Date().toISOString().slice(0, 10);
    const bad = ["start_date", "iqama_expiry", "work_permit_expiry", "contract_end_date"].find((k) => r[k] && !/^\d{4}-\d{2}-\d{2}$/.test(String(r[k])));
    if (!r.full_name) errors.push(`السطر ${i + 2}: الاسم فارغ`);
    else if (bad) errors.push(`السطر ${i + 2}: التاريخ في عمود ${bad} بصيغة YYYY-MM-DD`);
    else {
      if (r.nationality === "SAUDI") { r.iqama_expiry = null; r.work_permit_expiry = null; }
      rows.push(r);
    }
  });
  return { rows, errors };
}
