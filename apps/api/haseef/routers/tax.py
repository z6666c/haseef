"""الزكاة والضريبة: ملف ضريبي مختصر، ومهام الإقرارات بمواعيدها النظامية، وتأكيد الإنجاز برقم مرجعي.

حصيف لا يقدّم الإقرارات نيابة عن المنشأة ولا يتصل ببوابة هيئة الزكاة والضريبة والجمارك.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from ..deps import Tenant, get_tenant
from ..domain.tax import LABEL, period_label
from ..services import governance_service as gs
from ..services import tax_service
from .compliance import _audit

router = APIRouter(prefix="/tax", tags=["tax"])
MANAGERS = ("ORG_ADMIN", "COMPLIANCE_OFFICER")


def _num(v):
    return float(v) if isinstance(v, Decimal) else v


@router.get("/overview")
def overview(t: Tenant = Depends(get_tenant)):
    today = gs.riyadh_today()
    tax_service.ensure_tasks(t.conn, t.org_id, today)
    prof = t.conn.execute(text("""SELECT vat_registered, vat_frequency, withholding_applies, zakat_applies, fiscal_year_end_month
                                  FROM tax_profiles""")).mappings().one_or_none()
    rows = t.conn.execute(text("""
        SELECT x.id, x.kind, x.period_start, x.period_end, x.due_date, x.amount, x.done_at, x.reference, u.full_name AS done_by_name
        FROM tax_tasks x LEFT JOIN users u ON u.id = x.done_by
        WHERE x.done_at IS NULL OR x.due_date >= :from ORDER BY x.due_date DESC"""),
        {"from": date(today.year - 1, today.month, 1)}).mappings()
    tasks = []
    for r in rows:
        d = {k: _num(v) for k, v in dict(r).items()}
        d["label"] = LABEL[r["kind"]]
        d["period_label"] = period_label(r["kind"], r["period_start"], r["period_end"])
        d["days_left"] = (r["due_date"] - today).days
        d["overdue"] = r["done_at"] is None and d["days_left"] < 0
        tasks.append(d)
    return {"enabled": prof is not None, "profile": dict(prof) if prof else None, "tasks": tasks,
            "can_manage": t.role in MANAGERS, "today": today}


class TaxProfileIn(BaseModel):
    vat_registered: bool = False
    vat_frequency: Literal["MONTHLY", "QUARTERLY"] = "QUARTERLY"
    withholding_applies: bool = False
    zakat_applies: bool = True
    fiscal_year_end_month: int = Field(12, ge=1, le=12)


@router.put("/profile")
def set_profile(body: TaxProfileIn, t: Tenant = Depends(get_tenant)):
    t.require(*MANAGERS)
    t.conn.execute(text("""
        INSERT INTO tax_profiles (org_id, vat_registered, vat_frequency, withholding_applies, zakat_applies, fiscal_year_end_month)
        VALUES (:o, :vat_registered, :vat_frequency, :withholding_applies, :zakat_applies, :fiscal_year_end_month)
        ON CONFLICT (org_id) DO UPDATE SET vat_registered = EXCLUDED.vat_registered, vat_frequency = EXCLUDED.vat_frequency,
            withholding_applies = EXCLUDED.withholding_applies, zakat_applies = EXCLUDED.zakat_applies,
            fiscal_year_end_month = EXCLUDED.fiscal_year_end_month, updated_at = now()"""), {**body.model_dump(), "o": t.org_id})
    # المهام المفتوحة التي لم تعد تنطبق تُحذف (مثلاً إلغاء الاستقطاع أو تغيير دورية القيمة المضافة)
    t.conn.execute(text("""DELETE FROM tax_tasks WHERE done_at IS NULL AND (
            (kind = 'VAT_RETURN' AND (NOT :vat OR (:freq = 'MONTHLY') <> (period_end - period_start < 32)))
         OR (kind = 'WHT_RETURN' AND NOT :wht) OR (kind = 'ZAKAT_RETURN' AND NOT :zakat)
         OR (kind = 'ZAKAT_RETURN' AND extract(month FROM period_end) <> :fye))"""),
        {"vat": body.vat_registered, "freq": body.vat_frequency, "wht": body.withholding_applies,
         "zakat": body.zakat_applies, "fye": body.fiscal_year_end_month})
    t.conn.execute(text("""UPDATE org_governance_profiles SET vat_registered = :v, fiscal_year_end_month = :m"""),
                   {"v": body.vat_registered, "m": body.fiscal_year_end_month})
    _audit(t.conn, t, "UPSERT", "tax_profile", None, body.model_dump())
    tax_service.ensure_tasks(t.conn, t.org_id, gs.riyadh_today())
    return {"ok": True}


class DoneIn(BaseModel):
    reference: str | None = Field(None, max_length=100)
    amount: float | None = Field(None, ge=0)


@router.post("/tasks/{task_id}/done")
def done(task_id: UUID, body: DoneIn, t: Tenant = Depends(get_tenant)):
    t.require(*MANAGERS)
    n = t.conn.execute(text("""UPDATE tax_tasks SET done_at = now(), done_by = :u, reference = :r, amount = COALESCE(:a, amount)
                               WHERE id = :id AND done_at IS NULL"""),
                       {"u": t.principal.user_id, "r": body.reference, "a": body.amount, "id": task_id}).rowcount
    if not n:
        raise HTTPException(status.HTTP_409_CONFLICT, "الإقرار غير موجود أو مؤكَّد مسبقاً")
    _audit(t.conn, t, "DONE", "tax_task", task_id, body.model_dump())
    return {"ok": True}


@router.post("/tasks/{task_id}/reopen")
def reopen(task_id: UUID, t: Tenant = Depends(get_tenant)):
    t.require(*MANAGERS)
    n = t.conn.execute(text("UPDATE tax_tasks SET done_at = NULL, done_by = NULL WHERE id = :id AND done_at IS NOT NULL"),
                       {"id": task_id}).rowcount
    if not n:
        raise HTTPException(status.HTTP_409_CONFLICT, "الإقرار غير مؤكَّد")
    _audit(t.conn, t, "REOPEN", "tax_task", task_id)
    return {"ok": True}
