"""الأسعار من قاعدة البيانات (تُعدَّل من غرفة العمليات): الباقات والإضافات وأحقية المنشأة في الإضافة."""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from sqlalchemy import Connection, text

from .entitlements import org_plan


def _f(v):
    return float(v) if isinstance(v, Decimal) else v


def plans(conn: Connection) -> list[dict]:
    return [{k: _f(v) for k, v in dict(r).items()} for r in conn.execute(text("""
        SELECT tier, name_ar, monthly_price_sar, yearly_price_sar, monthly_whatsapp_alerts
        FROM plans ORDER BY monthly_price_sar""")).mappings()]


def addons(conn: Connection) -> list[dict]:
    return [{k: _f(v) for k, v in dict(r).items()} for r in conn.execute(text("""
        SELECT code, name, monthly_price, included_tiers, limits, is_active FROM addon_catalog ORDER BY code""")).mappings()]


def addon(conn: Connection, code: str) -> dict | None:
    return next((a for a in addons(conn) if a["code"] == code), None)


def addon_access(conn: Connection, org_id: UUID | str, code: str) -> dict:
    """هل الإضافة مفعّلة للمنشأة؟ عبر باقتها (مجاناً) أو باشتراك مدفوع ساري."""
    a = addon(conn, code)
    plan = org_plan(conn, org_id)
    out = {"code": code, "name": a["name"] if a else code, "price": a["monthly_price"] if a else None,
           "via": None, "paid_until": None, "limits": {}, "plan_tier": plan["plan_tier"]}
    if not a or not a["is_active"] or not plan["plan_tier"]:
        return out
    limits = dict(a["limits"] or {})
    if plan["plan_tier"] in (a["included_tiers"] or []):
        out.update(via="PLAN", limits={} if limits.get("included_unlimited") else limits)
        return out
    row = conn.execute(text("""SELECT paid_until FROM org_addons WHERE org_id = :o AND code = :c AND status = 'ACTIVE'
                               AND paid_until > now()"""), {"o": str(org_id), "c": code}).mappings().one_or_none()
    if row:
        out.update(via="ADDON", paid_until=row["paid_until"], limits=limits)
    # إضافة أكبر (شريحة 75 موظفاً) أو حزمة تمنح هذه الإضافة: تؤخذ الأوسع حدوداً
    for g in grantors(conn, code):
        r = conn.execute(text("""SELECT paid_until FROM org_addons WHERE org_id = :o AND code = :c AND status = 'ACTIVE'
                                 AND paid_until > now()"""), {"o": str(org_id), "c": g["code"]}).mappings().one_or_none()
        if not r:
            continue
        gl = {k: v for k, v in (g["limits"] or {}).items() if k != "grants"}
        mine = out["limits"].get("members") if out["via"] else -1
        if not out["via"] or (gl.get("members") or 10**9) > (mine or 10**9):
            out.update(via="ADDON", paid_until=r["paid_until"], limits={**limits, **gl}, granted_by=g["code"])
    return out


def grantors(conn: Connection, code: str) -> list[dict]:
    """الإضافات الفعّالة التي تشمل هذه الإضافة (limits.grants)."""
    return [a for a in addons(conn) if a["is_active"] and code in ((a["limits"] or {}).get("grants") or [])]
