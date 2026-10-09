"""تقويم الزكاة والضريبة (منطق نقي). مطابق لـ packages/shared/src/tax.ts.

  * ضريبة القيمة المضافة: شهرية إذا تجاوزت التوريدات السنوية 40 مليون ريال، وإلا ربع سنوية (أرباع تقويمية).
    الإقرار والسداد حتى آخر يوم من الشهر التالي لنهاية الفترة.
  * ضريبة الاستقطاع (مدفوعات لغير مقيمين): إقرار شهري خلال أول عشرة أيام من الشهر التالي.
  * الزكاة: الإقرار والسداد خلال 120 يوماً من نهاية السنة المالية.
"""

from __future__ import annotations

import calendar
from datetime import date, timedelta

KINDS = ("VAT_RETURN", "WHT_RETURN", "ZAKAT_RETURN")
LABEL = {"VAT_RETURN": "إقرار ضريبة القيمة المضافة", "WHT_RETURN": "إقرار ضريبة الاستقطاع", "ZAKAT_RETURN": "الإقرار الزكوي"}


def month_end(d: date) -> date:
    return d.replace(day=calendar.monthrange(d.year, d.month)[1])


def add_months(d: date, n: int) -> date:
    t = d.year * 12 + d.month - 1 + n
    return date(t // 12, t % 12 + 1, 1)


def vat_periods(today: date, frequency: str) -> list[tuple[date, date]]:
    """الفترة المنتهية الأخيرة والفترة الجارية."""
    cur = today.replace(day=1)
    if frequency == "MONTHLY":
        starts = [add_months(cur, -1), cur]
        return [(s, month_end(s)) for s in starts]
    q = date(today.year, (today.month - 1) // 3 * 3 + 1, 1)
    starts = [add_months(q, -3), q]
    return [(s, month_end(add_months(s, 2))) for s in starts]


def vat_due(period_end: date) -> date:
    return month_end(period_end + timedelta(days=1))


def wht_periods(today: date) -> list[tuple[date, date]]:
    cur = today.replace(day=1)
    return [(s, month_end(s)) for s in (add_months(cur, -1), cur)]


def wht_due(period_end: date) -> date:
    return (period_end + timedelta(days=1)).replace(day=10)


def fiscal_years(today: date, end_month: int) -> list[tuple[date, date]]:
    """السنة المالية المنتهية الأخيرة والجارية."""
    end_this = month_end(date(today.year, end_month, 1))
    cur_end = end_this if today <= end_this else month_end(date(today.year + 1, end_month, 1))
    prev_end = month_end(date(cur_end.year - 1, end_month, 1))
    def start_of(e: date) -> date:
        return add_months(e.replace(day=1), -11)
    return [(start_of(prev_end), prev_end), (start_of(cur_end), cur_end)]


def zakat_due(fy_end: date) -> date:
    return fy_end + timedelta(days=120)


def plan(today: date, *, vat_registered: bool, vat_frequency: str, withholding: bool, zakat: bool,
         fiscal_end_month: int) -> list[dict]:
    out: list[dict] = []
    if vat_registered:
        out += [dict(kind="VAT_RETURN", start=s, end=e, due=vat_due(e)) for s, e in vat_periods(today, vat_frequency)]
    if withholding:
        out += [dict(kind="WHT_RETURN", start=s, end=e, due=wht_due(e)) for s, e in wht_periods(today)]
    if zakat:
        out += [dict(kind="ZAKAT_RETURN", start=s, end=e, due=zakat_due(e)) for s, e in fiscal_years(today, fiscal_end_month)]
    return out


def period_label(kind: str, start: date, end: date) -> str:
    if kind == "ZAKAT_RETURN":
        return f"السنة المالية المنتهية {end:%m/%Y}"
    if (start.year, start.month) == (end.year, end.month):
        return f"شهر {start:%m/%Y}"
    return f"الربع {start:%m}–{end:%m/%Y}"
