"""خدمة العمل والموظفين: توليد المهام الشهرية وحساب اشتراكات التأمينات من سجل الموظفين."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Connection, text

from ..domain.labor import TASK_KINDS, Rate, contribution, due_date, periods_to_plan, pick_rate, rate_system


def load_rates(conn: Connection) -> list[Rate]:
    return [Rate(**dict(r)) for r in conn.execute(text("""
        SELECT system, effective_from, employee_annuity, employer_annuity, employee_saned, employer_saned,
               employer_hazards, min_base, max_base FROM gosi_rates ORDER BY system, effective_from""")).mappings()]


def gosi_for_month(conn: Connection, org_id: UUID | str, period: date, rates: list[Rate] | None = None) -> dict:
    """اشتراكات الشهر لموظفي المنشأة (تصفية صريحة بالمنشأة لأن المهمة اليومية تعمل بدور المنصة)."""
    rates = rates if rates is not None else load_rates(conn)
    rows = conn.execute(text("""
        SELECT id, full_name, nationality, gosi_system, basic_wage, housing_allowance, gosi_registered
        FROM org_employees WHERE org_id = :o AND is_active AND start_date <= (CAST(:p AS date) + interval '1 month' - interval '1 day')
        ORDER BY full_name"""), {"o": org_id, "p": period}).mappings().all()
    lines, emp_total, er_total = [], Decimal("0"), Decimal("0")
    for e in rows:
        rate = pick_rate(rates, rate_system(e["nationality"], e["gosi_system"]), period)
        if rate is None:
            continue
        c = contribution(e["basic_wage"], e["housing_allowance"], rate)
        emp_total += c["employee"]
        er_total += c["employer"]
        lines.append({"employee_id": e["id"], "full_name": e["full_name"], "nationality": e["nationality"],
                      "gosi_system": e["gosi_system"], "gosi_registered": e["gosi_registered"], **c})
    return {"period": period, "lines": lines, "employee_total": emp_total, "employer_total": er_total,
            "total": emp_total + er_total}


def ensure_tasks(conn: Connection, org_id: UUID | str, today: date) -> int:
    """ينشئ مهام الشهر الماضي والحالي إن لم توجد (idempotent). المنشأة مفعّلة بوجود ملف labor_profiles."""
    prof = conn.execute(text("SELECT salary_day FROM labor_profiles WHERE org_id = :o"), {"o": org_id}).scalar_one_or_none()
    if prof is None:
        return 0
    rates = load_rates(conn)
    n = 0
    for period in periods_to_plan(today):
        amount = gosi_for_month(conn, org_id, period, rates)["total"] or None
        for kind in TASK_KINDS:
            n += conn.execute(text("""
                INSERT INTO labor_tasks (org_id, period, kind, due_date, amount)
                VALUES (:o, :p, :k, :d, :a) ON CONFLICT (org_id, period, kind) DO NOTHING"""),
                {"o": org_id, "p": period, "k": kind, "d": due_date(kind, period, prof),
                 "a": amount if kind == "GOSI_PAYMENT" else None}).rowcount
    return n


def ensure_all(platform_tx, today: date) -> int:
    """مهمة يومية: لكل منشأة فعّلت تقويم العمل."""
    with platform_tx() as c:
        orgs = c.execute(text("""SELECT lp.org_id FROM labor_profiles lp JOIN organizations o ON o.id = lp.org_id
                                 WHERE o.is_active""")).scalars().all()
    total = 0
    for org in orgs:
        with platform_tx() as c:
            total += ensure_tasks(c, org, today)
    return total
