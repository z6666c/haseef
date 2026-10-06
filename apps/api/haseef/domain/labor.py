"""العمل والموظفين: حساب اشتراكات التأمينات الاجتماعية، ومواعيد المهام الشهرية، ومؤشرات قوى (منطق نقي).

مطابق لـ packages/shared/src/labor.ts.
  * الأجر الخاضع = الأساسي + بدل السكن، بحد أدنى 1,500 وأعلى 45,000 ريال.
  * السعودي: معاشات (موظف + صاحب عمل) + ساند (0.75% لكل طرف) + أخطار مهنية 2% على صاحب العمل.
    النظام الجديد (أول تسجيل بعد 3 يوليو 2024) ترتفع فيه نسبة المعاشات تدريجياً كل يوليو حتى 11%.
  * غير السعودي: أخطار مهنية 2% على صاحب العمل فقط.
  * السداد حتى اليوم 15 من الشهر التالي، وغرامة التأخير 2% عن كل شهر.
  * ملف حماية الأجور في مُدد: خلال 30 يوماً من نهاية الشهر.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

TASK_KINDS = ("SALARY_PAYMENT", "GOSI_PAYMENT", "WPS_UPLOAD")
TASK_LABEL = {
    "GOSI_PAYMENT": "سداد اشتراكات التأمينات الاجتماعية",
    "WPS_UPLOAD": "رفع ملف حماية الأجور في مُدد",
    "SALARY_PAYMENT": "صرف الرواتب",
}
GOSI_LATE_PENALTY = Decimal("0.02")


def r2(x) -> Decimal:
    return Decimal(str(x)).quantize(Decimal("0.01"), ROUND_HALF_UP)


@dataclass(frozen=True)
class Rate:
    system: str
    effective_from: date
    employee_annuity: Decimal
    employer_annuity: Decimal
    employee_saned: Decimal
    employer_saned: Decimal
    employer_hazards: Decimal
    min_base: Decimal = Decimal("1500")
    max_base: Decimal = Decimal("45000")


def rate_system(nationality: str, gosi_system: str) -> str:
    return "NON_SAUDI" if nationality == "NON_SAUDI" else gosi_system


def pick_rate(rates: list[Rate], system: str, on: date) -> Rate | None:
    """أحدث نسبة سارية في التاريخ المطلوب."""
    valid = [r for r in rates if r.system == system and r.effective_from <= on]
    return max(valid, key=lambda r: r.effective_from) if valid else None


def contribution_base(basic, housing, rate: Rate) -> Decimal:
    raw = Decimal(str(basic)) + Decimal(str(housing))
    return min(max(raw, Decimal(rate.min_base)), Decimal(rate.max_base))


def contribution(basic, housing, rate: Rate) -> dict:
    base = contribution_base(basic, housing, rate)
    pct = lambda p: r2(base * Decimal(str(p)) / 100)  # noqa: E731
    employee = pct(Decimal(rate.employee_annuity) + Decimal(rate.employee_saned))
    employer = pct(Decimal(rate.employer_annuity) + Decimal(rate.employer_saned) + Decimal(rate.employer_hazards))
    return {"base": r2(base), "employee": employee, "employer": employer, "total": employee + employer,
            "employee_pct": float(Decimal(rate.employee_annuity) + Decimal(rate.employee_saned)),
            "employer_pct": float(Decimal(rate.employer_annuity) + Decimal(rate.employer_saned) + Decimal(rate.employer_hazards))}


def month_start(d: date) -> date:
    return d.replace(day=1)


def next_month(d: date) -> date:
    return date(d.year + (d.month == 12), d.month % 12 + 1, 1)


def due_date(kind: str, period: date, salary_day: int = 27) -> date:
    """موعد المهمة الشهرية الخاصة بشهر period."""
    if kind == "SALARY_PAYMENT":
        return period.replace(day=min(salary_day, calendar.monthrange(period.year, period.month)[1]))
    if kind == "GOSI_PAYMENT":
        return next_month(period).replace(day=15)
    if kind == "WPS_UPLOAD":
        return next_month(period) - timedelta(days=1) + timedelta(days=30)
    raise ValueError(kind)


def periods_to_plan(today: date) -> list[date]:
    """المهام تُنشأ للشهر الماضي والحالي (الشهر الماضي لا تزال تأميناته وملف أجوره مستحقة)."""
    cur = month_start(today)
    prev = month_start(cur - timedelta(days=1))
    return [prev, cur]


def gosi_late_penalty(amount, due: date, paid_on: date) -> Decimal:
    """2% عن كل شهر تأخير (أو جزء منه)."""
    if paid_on <= due:
        return Decimal("0")
    months = (paid_on.year - due.year) * 12 + paid_on.month - due.month + (1 if paid_on.day > due.day else 0)
    return r2(Decimal(str(amount)) * GOSI_LATE_PENALTY * max(months, 1))


def wps_fine(workers: int) -> int:
    """غرامة عدم رفع ملف حماية الأجور حسب حجم المنشأة."""
    return 500 if workers <= 20 else 1000 if workers < 50 else 2000


def qiwa_indicators(employees: list[dict]) -> dict:
    active = [e for e in employees if e.get("is_active", True)]
    n = len(active)
    saudis = sum(1 for e in active if e["nationality"] == "SAUDI")
    documented = sum(1 for e in active if e.get("qiwa_contract_documented"))
    registered = sum(1 for e in active if e.get("gosi_registered"))
    return {
        "employees": n, "saudis": saudis, "non_saudis": n - saudis,
        "saudization_pct": round(saudis * 100 / n, 1) if n else 0.0,
        "documented": documented, "documented_pct": round(documented * 100 / n, 1) if n else 0.0,
        "gosi_registered": registered, "gosi_unregistered": n - registered,
        "wps_fine_if_missed": wps_fine(n) if n else 0,
    }
