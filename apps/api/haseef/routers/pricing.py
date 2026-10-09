"""التسعير من غرفة العمليات: أسعار الباقات وحصص الرسائل، والإضافات (السعر، الباقات التي تشملها مجاناً، الحدود).

التغيير يسري على الدفعات والتسجيلات الجديدة فوراً؛ الاشتراكات القائمة تبقى على ما دُفع حتى التجديد.
"""

from __future__ import annotations

import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from ..db import platform_tx
from ..deps import Admin, require_perm
from ..services import pricing

router = APIRouter(tags=["pricing"])
Tier = Literal["ESSENTIAL", "PROFESSIONAL_GRC", "ENTERPRISE"]


@router.get("/public/pricing")
def public_pricing():
    with platform_tx() as c:
        return {"plans": pricing.plans(c), "addons": [a for a in pricing.addons(c) if a["is_active"]]}


@router.get("/admin/pricing")
def admin_pricing(a: Admin = Depends(require_perm("finance.view", "billing.manage"))):
    return {"plans": pricing.plans(a.conn), "addons": pricing.addons(a.conn)}


class PlanPriceIn(BaseModel):
    monthly_price_sar: float = Field(gt=0, le=100000)
    yearly_price_sar: float = Field(gt=0, le=1000000)
    monthly_whatsapp_alerts: int | None = Field(None, ge=0, le=1000000)


@router.put("/admin/pricing/plans/{tier}")
def set_plan_price(tier: Tier, body: PlanPriceIn, a: Admin = Depends(require_perm("billing.manage"))):
    old = a.conn.execute(text("SELECT monthly_price_sar, yearly_price_sar, monthly_whatsapp_alerts FROM plans WHERE tier = :t"),
                         {"t": tier}).mappings().one()
    a.conn.execute(text("""UPDATE plans SET monthly_price_sar = :monthly_price_sar, yearly_price_sar = :yearly_price_sar,
                           monthly_whatsapp_alerts = :monthly_whatsapp_alerts WHERE tier = :t"""), {**body.model_dump(), "t": tier})
    a.audit("ADMIN_PLAN_PRICE", "plan", None, None, {"tier": tier, "from": {k: str(v) for k, v in old.items()}, "to": body.model_dump()})
    return {"ok": True}


class AddonIn(BaseModel):
    monthly_price: float = Field(ge=0, le=100000)
    included_tiers: list[Tier] = Field(default_factory=list)
    members: int | None = Field(None, ge=1, le=100000)
    questions: int | None = Field(None, ge=1, le=10000000)
    included_unlimited: bool = True
    is_active: bool = True


@router.put("/admin/pricing/addons/{code}")
def set_addon(code: str, body: AddonIn, a: Admin = Depends(require_perm("billing.manage"))):
    cur = pricing.addon(a.conn, code)
    if cur is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الإضافة غير موجودة")
    limits = {**(cur["limits"] or {}), "members": body.members, "questions": body.questions, "included_unlimited": body.included_unlimited}
    a.conn.execute(text("""UPDATE addon_catalog SET monthly_price = :p, included_tiers = :t, limits = CAST(:l AS jsonb),
                           is_active = :act, updated_at = now() WHERE code = :c"""),
                   {"p": body.monthly_price, "t": sorted(set(body.included_tiers)), "l": json.dumps(limits), "act": body.is_active, "c": code})
    a.audit("ADMIN_ADDON_PRICE", "addon", None, None, {"code": code, **body.model_dump()})
    return {"ok": True}
