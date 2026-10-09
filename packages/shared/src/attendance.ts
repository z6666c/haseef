/** تقييم تسجيل الحضور بالموقع — مطابق لـ apps/api/haseef/domain/attendance.py. */
export const ATT_REASON: Record<string, string> = {
  OUTSIDE: "خارج نطاق مواقع المنشأة", LOW_ACCURACY: "دقة الموقع ضعيفة", NO_SITE: "لم يُحدَّد موقع للمنشأة",
  NO_DEVICE: "الجهاز غير مربوط ببصمة", BAD_DEVICE: "تعذّر التحقق من البصمة", DUPLICATE: "سُجّل قبل قليل",
};
export const ATT_FLAG: Record<string, string> = { IMPOSSIBLE_TRAVEL: "تنقل غير منطقي", OFF_DAY: "خارج أيام العمل", FAR_ACCURACY: "دقة حدّية" };
export const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000, rad = Math.PI / 180;
  const p1 = lat1 * rad, p2 = lat2 * rad, dp = p2 - p1, dl = (lng2 - lng1) * rad;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export interface AttSite { id: string; lat: number; lng: number; radius_m: number; max_accuracy_m: number; is_active?: boolean; name?: string }
export interface AttResult { status: "ACCEPTED" | "REJECTED"; reason: string | null; site_id: string | null; distance_m: number | null; flags: string[]; late_minutes: number | null }

/** nowLocal: «YYYY-MM-DDTHH:MM» بتوقيت الرياض؛ weekday 0 = الأحد. */
export function evaluateAttendance(x: { lat: number; lng: number; accuracy: number; sites: AttSite[]; kind: "IN" | "OUT"; nowLocal: string; weekday: number;
  workStart: string; graceMinutes: number; workDays: number[]; last?: { atLocal: string; lat: number | null; lng: number | null } | null }): AttResult {
  const active = x.sites.filter((s) => s.is_active !== false);
  if (!active.length) return { status: "REJECTED", reason: "NO_SITE", site_id: null, distance_m: null, flags: [], late_minutes: null };
  const dist = (s: AttSite) => distanceM(x.lat, x.lng, s.lat, s.lng);
  const best = active.reduce((a, b) => (dist(b) < dist(a) ? b : a));
  const d = dist(best);
  const base = { site_id: best.id, distance_m: Math.round(d), flags: [] as string[], late_minutes: null as number | null };
  if (x.accuracy > best.max_accuracy_m) return { ...base, status: "REJECTED", reason: "LOW_ACCURACY" };
  if (d > best.radius_m + Math.min(x.accuracy, best.radius_m / 2)) return { ...base, status: "REJECTED", reason: "OUTSIDE" };
  if (d > best.radius_m) base.flags.push("FAR_ACCURACY");
  if (!x.workDays.includes(x.weekday)) base.flags.push("OFF_DAY");
  const mins = (a: string) => { const t = new Date(`${a}:00Z`).getTime(); return t / 60000; };
  if (x.last && x.last.lat != null && x.last.lng != null) {
    const m = Math.max(mins(x.nowLocal) - mins(x.last.atLocal), 0.1);
    if (distanceM(x.lat, x.lng, x.last.lat, x.last.lng) / 1000 / (m / 60) > 200) base.flags.push("IMPOSSIBLE_TRAVEL");
  }
  if (x.kind === "IN") {
    const start = mins(`${x.nowLocal.slice(0, 10)}T${x.workStart.slice(0, 5)}`) + x.graceMinutes;
    const late = mins(x.nowLocal) - start;
    base.late_minutes = late > 0 ? Math.ceil(late) : 0;
  }
  return { ...base, status: "ACCEPTED", reason: null };
}
