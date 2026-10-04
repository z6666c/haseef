"""اشتراك المنشأة كما يراه العميل: الباقة والمدة، جدول الأقساط (المدفوع والمتبقي والقادم)، وفواتيره.

بيانات الفوترة جداول منصة (لا يصل إليها دور العميل مباشرة)؛ لذا نتحقق من العضوية عبر get_tenant
ثم نقرأ بيانات هذه المنشأة وحدها بدور المنصة.
"""

from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text

from ..db import platform_tx
from ..deps import Tenant, get_tenant
from ..services import installments_service

router = APIRouter(prefix="/billing", tags=["billing"])


def _f(rows) -> list[dict]:
    return [{k: (float(v) if isinstance(v, Decimal) else v) for k, v in dict(r).items()} for r in rows]


@router.get("/overview")
def overview(t: Tenant = Depends(get_tenant)):
    if t.role not in ("ORG_ADMIN", "COMPLIANCE_OFFICER", "DPO", "VIEWER"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "بيانات الاشتراك متاحة لأعضاء المنشأة فقط")
    with platform_tx() as c:
        sub = c.execute(text("""
            SELECT s.plan_tier, s.billing_cycle, s.billing_status, s.starts_at, s.ends_at, p.monthly_price_sar, p.yearly_price_sar
            FROM subscriptions s JOIN plans p ON p.tier = s.plan_tier
            WHERE s.org_id = :o ORDER BY s.starts_at DESC LIMIT 1"""), {"o": t.org_id}).mappings().one_or_none()
        plans = installments_service.plans(c, org_id=t.org_id)
        active = next((p for p in plans if p["status"] == "ACTIVE"), plans[0] if plans else None)
        plan = installments_service.plan_detail(c, active["id"]) if active else None
        vat = c.execute(text("SELECT vat_registered FROM haseef_profile WHERE id = 1")).scalar_one()
        invoices = c.execute(text("""
            SELECT id, number, kind, source, subtotal, vat_amount, total, issued_at, status
            FROM invoices WHERE org_id = :o ORDER BY issued_at DESC LIMIT 100"""), {"o": t.org_id}).mappings()
        out_plan = None
        if plan:
            out_plan = {**_f([{k: v for k, v in plan.items() if k != "items"}])[0],
                        "items": [{k: v for k, v in r.items() if k not in ("invoice_id",)} for r in _f(plan["items"])]}
        return {"subscription": _f([sub])[0] if sub else None, "plan": out_plan, "vat_rate": 0.15 if vat else 0.0,
                "invoices": _f(invoices)}
