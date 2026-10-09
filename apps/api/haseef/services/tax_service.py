"""مهام الزكاة والضريبة: تُنشأ تلقائياً للفترة المنتهية الأخيرة والجارية لكل منشأة فعّلت ملفها الضريبي."""

from __future__ import annotations

from datetime import date
from uuid import UUID

from sqlalchemy import Connection, text

from ..domain.tax import plan


def ensure_tasks(conn: Connection, org_id: UUID | str, today: date) -> int:
    p = conn.execute(text("""SELECT vat_registered, vat_frequency, withholding_applies, zakat_applies, fiscal_year_end_month
                             FROM tax_profiles WHERE org_id = :o"""), {"o": org_id}).mappings().one_or_none()
    if p is None:
        return 0
    n = 0
    for t in plan(today, vat_registered=p["vat_registered"], vat_frequency=p["vat_frequency"],
                  withholding=p["withholding_applies"], zakat=p["zakat_applies"], fiscal_end_month=p["fiscal_year_end_month"]):
        n += conn.execute(text("""
            INSERT INTO tax_tasks (org_id, kind, period_start, period_end, due_date)
            VALUES (:o, :k, :s, :e, :d) ON CONFLICT (org_id, kind, period_start) DO NOTHING"""),
            {"o": org_id, "k": t["kind"], "s": t["start"], "e": t["end"], "d": t["due"]}).rowcount
    return n


def ensure_all(platform_tx, today: date) -> int:
    with platform_tx() as c:
        orgs = c.execute(text("""SELECT tp.org_id FROM tax_profiles tp JOIN organizations o ON o.id = tp.org_id
                                 WHERE o.is_active""")).scalars().all()
    total = 0
    for org in orgs:
        with platform_tx() as c:
            total += ensure_tasks(c, org, today)
    return total
