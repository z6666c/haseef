/** الإجازات والخصومات (منطق نقي). مطابق لـ apps/api/haseef/domain/hr.py. */

export type LeaveType = "ANNUAL" | "REGULAR" | "EMERGENCY" | "SICK";
export type DeductionKind = "LATE" | "ABSENCE" | "LATE_RETURN" | "VIOLATION" | "OTHER";
export const LEAVE_TYPES: LeaveType[] = ["ANNUAL", "REGULAR", "EMERGENCY", "SICK"];
export const LEAVE_LABEL: Record<LeaveType, string> = { ANNUAL: "سنوية", REGULAR: "اعتيادية", EMERGENCY: "اضطرارية", SICK: "مرضية" };
export interface LeavePolicy { is_paid: boolean; from_balance: boolean; max_days_per_request: number | null; yearly_cap: number | null; min_notice_days: number; is_active?: boolean }
export const DEFAULT_POLICIES: Record<LeaveType, LeavePolicy> = {
  ANNUAL: { is_paid: true, from_balance: true, max_days_per_request: null, yearly_cap: null, min_notice_days: 0 },
  REGULAR: { is_paid: false, from_balance: false, max_days_per_request: 30, yearly_cap: null, min_notice_days: 0 },
  EMERGENCY: { is_paid: true, from_balance: true, max_days_per_request: 3, yearly_cap: 5, min_notice_days: 0 },
  SICK: { is_paid: true, from_balance: false, max_days_per_request: null, yearly_cap: 120, min_notice_days: 0 },
};
export const SICK_BACKDATE_DAYS = 7;
const SICK_TIERS: [number, number][] = [[30, 1], [60, 0.75], [30, 0]];
export const KIND_LABEL: Record<DeductionKind, string> = { LATE: "تأخر عن الدوام", ABSENCE: "غياب", LATE_RETURN: "تأخر عن المباشرة بعد الإجازة",
  VIOLATION: "مخالفة لائحة تنظيم العمل", OTHER: "أخرى" };
export const FINE_KINDS: DeductionKind[] = ["LATE", "VIOLATION", "OTHER"];
export const LEAVE_STATUS: Record<string, string> = { PENDING: "بانتظار القرار", APPROVED: "موافق عليها", REJECTED: "مرفوضة", CANCELLED: "ملغاة" };
export const NOTICE_STATUS: Record<string, string> = { ISSUED: "صادر", OBJECTED: "معترض عليه", CONFIRMED: "مؤكد", CANCELLED: "ملغى" };

const DAY = 86_400_000;
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => iso(new Date(parse(s).getTime() + n * DAY));
export const diffDays = (a: string, b: string) => Math.round((parse(a).getTime() - parse(b).getTime()) / DAY);
/** 0 = الأحد */
export const weekday0 = (s: string) => parse(s).getUTCDay();

export function annualEntitlement(startDate: string, on: string): number {
  const [sy, sm, sd] = startDate.split("-").map(Number), [y, m, d] = on.split("-").map(Number);
  const years = y - sy - ((m < sm || (m === sm && d < sd)) ? 1 : 0);
  return years >= 5 ? 30 : 21;
}

export function holidayDates(events: { event_date: string; is_holiday: boolean; holiday_days: number; is_active?: boolean }[]): Set<string> {
  const out = new Set<string>();
  for (const e of events) if (e.is_holiday && e.is_active !== false) for (let i = 0; i < Math.max(e.holiday_days || 1, 1); i++) out.add(addDays(e.event_date, i));
  return out;
}

export function countLeaveDays(start: string, end: string, o: { workDays: number[]; holidays: Set<string>; workdaysOnly: boolean }): number {
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) if (!o.workdaysOnly || (o.workDays.includes(weekday0(d)) && !o.holidays.has(d))) n++;
  return n;
}

export function lateReturnDays(endDate: string, returnDate: string, workDays: number[], holidays: Set<string>): number {
  if (returnDate <= addDays(endDate, 1)) return 0;
  return countLeaveDays(addDays(endDate, 1), addDays(returnDate, -1), { workDays, holidays, workdaysOnly: true });
}

export const fmtDays = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

export function validateLeave(o: { leaveType: LeaveType; start: string; end: string; days: number; today: string; policy: LeavePolicy; byHr: boolean;
  balance: number; usedThisYearType: number }): string | null {
  const p = o.policy;
  if (p.is_active === false) return `الإجازة ال${LEAVE_LABEL[o.leaveType]} غير متاحة في منشأتك`;
  if (o.end < o.start) return "تاريخ النهاية قبل البداية";
  if (diffDays(o.end, o.start) > 365) return "مدة الإجازة طويلة جداً";
  if (o.days <= 0) return "الفترة المختارة لا تتضمن أيام عمل";
  if (!o.byHr) {
    const earliest = o.leaveType === "EMERGENCY" ? addDays(o.today, -3) : o.leaveType === "SICK" ? addDays(o.today, -SICK_BACKDATE_DAYS) : addDays(o.today, p.min_notice_days || 0);
    if (o.start < earliest) {
      return o.leaveType === "EMERGENCY" ? "الإجازة الاضطرارية تُرفع خلال 3 أيام من بدايتها كحد أقصى"
        : o.leaveType === "SICK" ? `الإجازة المرضية تُرفع خلال ${SICK_BACKDATE_DAYS} أيام من بدايتها كحد أقصى`
        : p.min_notice_days ? `يجب رفع الطلب قبل ${p.min_notice_days} يوم على الأقل` : "لا يمكن رفع إجازة بتاريخ مضى";
    }
  }
  if (p.max_days_per_request && o.days > p.max_days_per_request) return `الحد الأقصى للطلب الواحد ${p.max_days_per_request} يوم`;
  if (p.yearly_cap && o.usedThisYearType + o.days > p.yearly_cap) return `تجاوزت الحد السنوي (${p.yearly_cap} يوم) لهذا النوع؛ المتبقي ${Math.max(p.yearly_cap - o.usedThisYearType, 0)}`;
  if (p.from_balance && o.days > o.balance) return `الرصيد غير كافٍ: المتبقي ${fmtDays(o.balance)} يوم`;
  return null;
}

export function sickSplit(usedBefore: number, days: number): [number, number][] {
  const out: [number, number][] = [];
  let pos = 0;
  for (const [size, rate] of SICK_TIERS) {
    const take = Math.max(0, Math.min(pos + size, usedBefore + days) - Math.max(pos, usedBefore));
    if (take) out.push([take, rate]);
    pos += size;
  }
  const rest = days - out.reduce((a, [t]) => a + t, 0);
  if (rest > 0) out.push([rest, 0]);
  return out;
}
export function sickNote(usedBefore: number, days: number): string {
  const parts: Record<number, string> = { 1: "بأجر كامل", 0.75: "بثلاثة أرباع الأجر", 0: "دون أجر" };
  return sickSplit(usedBefore, days).map(([d, r]) => `${d} يوم ${parts[r]}`).join("، ");
}

export const dailyWage = (basic: number, housing: number) => Math.round(((basic + housing) / 30) * 100) / 100;
export const lateAmount = (minutes: number, dwage: number, workMinutes: number) => Math.round(dwage * minutes / Math.max(workMinutes, 1) * 100) / 100;

export function validateDeduction(o: { kind: DeductionKind; amount: number; incident: string; today: string; dwage: number; monthlyWage: number;
  monthFines: number; monthTotal: number }): string | null {
  if (o.amount <= 0) return "المبلغ يجب أن يكون أكبر من صفر";
  if (o.incident > o.today) return "تاريخ الواقعة في المستقبل";
  const cap5 = Math.round(o.dwage * 5 * 100) / 100;
  if (FINE_KINDS.includes(o.kind)) {
    if (diffDays(o.today, o.incident) > 30) return "مضى أكثر من 30 يوماً على الواقعة؛ لا يجوز توقيع الجزاء نظاماً";
    if (o.amount > cap5) return `الغرامة عن المخالفة الواحدة لا تتجاوز أجر خمسة أيام (${cap5.toFixed(2)} ريال)`;
    if (o.monthFines + o.amount > cap5) return `مجموع الغرامات في الشهر لا يتجاوز أجر خمسة أيام (${cap5.toFixed(2)} ريال)؛ المتاح ${Math.max(cap5 - o.monthFines, 0).toFixed(2)}`;
  }
  const half = Math.round(o.monthlyWage / 2 * 100) / 100;
  if (o.monthTotal + o.amount > half) return `مجموع الحسم في الشهر لا يتجاوز نصف الأجر (${half.toFixed(2)} ريال)؛ المتاح ${Math.max(half - o.monthTotal, 0).toFixed(2)}`;
  return null;
}
