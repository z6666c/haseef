"""تقييم تسجيل الحضور بالموقع (منطق نقي). مطابق لـ packages/shared/src/attendance.ts.

  * المسافة بصيغة هافرساين، ويُقبل التسجيل إذا كان داخل نصف قطر أحد المواقع وكانت دقة القراءة ضمن الحد.
  * القراءة الأقل دقة من الحد تُرفض (لا نعرف أين الموظف فعلاً) مع رسالة تطلب الخروج لمكان مكشوف أو تفعيل GPS.
  * علامات اشتباه لا ترفض لكنها تظهر للموارد البشرية: تنقل مستحيل، أو خارج أيام العمل.
"""

from __future__ import annotations

import math
from datetime import datetime, time, timedelta

EARTH_M = 6_371_000
REASON_LABEL = {
    "OUTSIDE": "خارج نطاق مواقع المنشأة", "LOW_ACCURACY": "دقة الموقع ضعيفة", "NO_SITE": "لم يُحدَّد موقع للمنشأة",
    "NO_DEVICE": "الجهاز غير مربوط ببصمة", "BAD_DEVICE": "تعذّر التحقق من البصمة", "DUPLICATE": "سُجّل قبل قليل",
}
FLAG_LABEL = {"IMPOSSIBLE_TRAVEL": "تنقل غير منطقي", "OFF_DAY": "خارج أيام العمل", "FAR_ACCURACY": "دقة حدّية"}


def distance_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_M * math.asin(math.sqrt(a))


def evaluate(*, lat: float, lng: float, accuracy: float, sites: list[dict], kind: str, now_local: datetime,
             work_start: time, grace_minutes: int, work_days: list[int], last: dict | None = None) -> dict:
    """sites: [{id, lat, lng, radius_m, max_accuracy_m}]؛ last: {at (local), lat, lng} لآخر تسجيل مقبول."""
    active = [s for s in sites if s.get("is_active", True)]
    if not active:
        return {"status": "REJECTED", "reason": "NO_SITE", "site_id": None, "distance_m": None, "flags": [], "late_minutes": None}
    best = min(active, key=lambda s: distance_m(lat, lng, float(s["lat"]), float(s["lng"])))
    d = distance_m(lat, lng, float(best["lat"]), float(best["lng"]))
    out = {"site_id": best["id"], "distance_m": round(d), "flags": [], "late_minutes": None}
    if accuracy > best["max_accuracy_m"]:
        return {**out, "status": "REJECTED", "reason": "LOW_ACCURACY"}
    # نسمح بهامش من دقة القراءة بحد أقصى نصف نصف القطر، حتى لا يُرفض من يقف عند الباب
    allowed = best["radius_m"] + min(accuracy, best["radius_m"] / 2)
    if d > allowed:
        return {**out, "status": "REJECTED", "reason": "OUTSIDE"}
    if d > best["radius_m"]:
        out["flags"].append("FAR_ACCURACY")
    if (now_local.weekday() + 1) % 7 not in work_days:          # Python: الاثنين 0 → نحوّل إلى الأحد 0
        out["flags"].append("OFF_DAY")
    if last and last.get("lat") is not None:
        mins = max((now_local - last["at"]).total_seconds() / 60, 0.1)
        km = distance_m(lat, lng, float(last["lat"]), float(last["lng"])) / 1000
        if km / (mins / 60) > 200:                              # أسرع من 200 كم/س
            out["flags"].append("IMPOSSIBLE_TRAVEL")
    if kind == "IN":
        start = datetime.combine(now_local.date(), work_start) + timedelta(minutes=grace_minutes)
        late = (now_local - start).total_seconds() / 60
        out["late_minutes"] = max(0, math.ceil(late)) if late > 0 else 0
    return {**out, "status": "ACCEPTED", "reason": None}
