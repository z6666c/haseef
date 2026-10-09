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


# ---------------------------------------------------------------- شرائح الموارد البشرية وعرض الإطلاق
def hr_tiers(conn: Connection) -> list[dict]:
    """شرائح الموارد البشرية الفعّالة مرتبة بعدد الموظفين (ATTENDANCE ثم ما يمنحها وحدها، دون الحزمة)."""
    out = [a for a in addons(conn) if a["is_active"] and (a["code"] == "ATTENDANCE" or ((a["limits"] or {}).get("grants") or []) == ["ATTENDANCE"])]
    return sorted(out, key=lambda a: (a["limits"] or {}).get("members") or 10**9)


def tier_for(conn: Connection, employees: int) -> dict | None:
    """أصغر شريحة تكفي عدد الموظفين؛ None إن تجاوزوا أكبر شريحة (يُوجَّه لكبار العملاء)."""
    return next((a for a in hr_tiers(conn) if ((a["limits"] or {}).get("members") or 10**9) >= employees), None)


def _active_employees(conn: Connection, org_id) -> int:
    return conn.execute(text("SELECT count(*) FROM org_employees WHERE org_id = :o AND is_active"), {"o": str(org_id)}).scalar_one()


def promo_status(conn: Connection, code: str, org_id=None) -> dict | None:
    p = conn.execute(text("SELECT *, (ends_at IS NULL OR ends_at > now()) AS in_window FROM promotions WHERE code = :c"), {"c": code}).mappings().one_or_none()
    if p is None:
        return None
    used = conn.execute(text("SELECT count(*) FROM promotion_redemptions WHERE promo_code = :c"), {"c": code}).scalar_one()
    live = bool(p["is_active"]) and bool(p["in_window"])
    out = {"code": code, "name": p["name"], "free_months": p["free_months"], "max": p["max_redemptions"], "used": used,
           "remaining": max(p["max_redemptions"] - used, 0), "active": live and used < p["max_redemptions"],
           "is_active": bool(p["is_active"])}
    if org_id is not None:
        out.update(promo_eligibility(conn, code, org_id, out))
    return out


def promo_eligibility(conn: Connection, code: str, org_id, st: dict) -> dict:
    if conn.execute(text("SELECT 1 FROM promotion_redemptions WHERE promo_code = :c AND org_id = :o"), {"c": code, "o": str(org_id)}).first():
        return {"eligible": False, "reason": "استفدت من العرض مسبقاً"}
    if not st["active"]:
        return {"eligible": False, "reason": "انتهى العرض"}
    sub = conn.execute(text("SELECT plan_tier, billing_status FROM subscriptions WHERE org_id = :o AND billing_status IN ('TRIAL','ACTIVE','PAST_DUE')"),
                       {"o": str(org_id)}).mappings().one_or_none()
    if not sub or sub["billing_status"] != "ACTIVE":
        return {"eligible": False, "reason": "العرض للمشتركين باشتراك مدفوع ساري"}
    if addon_access(conn, org_id, "ATTENDANCE")["via"] == "PLAN":
        return {"eligible": False, "reason": "الموارد البشرية مشمولة في باقتك"}
    family = [a["code"] for a in hr_tiers(conn)] + [a["code"] for a in grantors(conn, "ATTENDANCE")]
    if conn.execute(text("SELECT 1 FROM org_addons WHERE org_id = :o AND code = ANY(:c)"), {"o": str(org_id), "c": list(set(family))}).first():
        return {"eligible": False, "reason": "العرض لمن لم يشترك في الموارد البشرية من قبل"}
    n = _active_employees(conn, org_id)
    tier = tier_for(conn, n)
    if tier is None:
        return {"eligible": False, "reason": f"عدد موظفيك ({n}) أكبر من شرائح الإضافة؛ باقة كبار العملاء تشملها بلا حد"}
    return {"eligible": True, "reason": None, "tier_code": tier["code"], "tier_name": tier["name"]}


def claim_promo(conn: Connection, code: str, org_id, user_id) -> dict:
    """يفعّل الشريحة المناسبة مجاناً للمدة المحددة. قفل على صف العرض يمنع تجاوز العدد مع الطلبات المتزامنة."""
    conn.execute(text("SELECT 1 FROM promotions WHERE code = :c FOR UPDATE"), {"c": code})
    st = promo_status(conn, code, org_id)
    if st is None:
        raise LookupError("العرض غير موجود")
    if not st.get("eligible"):
        raise PermissionError(st.get("reason") or "غير مؤهل للعرض")
    until = conn.execute(text("""
        INSERT INTO org_addons (org_id, code, status, paid_until) VALUES (:o, :c, 'ACTIVE', now() + make_interval(months => :m))
        RETURNING paid_until"""), {"o": str(org_id), "c": st["tier_code"], "m": st["free_months"]}).scalar_one()
    conn.execute(text("""INSERT INTO promotion_redemptions (promo_code, org_id, addon_code, paid_until, redeemed_by)
                         VALUES (:p, :o, :c, :u, :by)"""), {"p": code, "o": str(org_id), "c": st["tier_code"], "u": until, "by": user_id})
    return {"addon_code": st["tier_code"], "addon_name": st["tier_name"], "paid_until": until}


def hr_mix(conn: Connection) -> dict:
    """للمراجعة الدورية: من اختار الحزمة مقابل الموارد البشرية وحدها (اشتراكات مدفوعة سارية، دون العرض المجاني)."""
    rows = dict(conn.execute(text("""
        SELECT CASE WHEN a.code = 'STAFF_BUNDLE' THEN 'bundle' ELSE 'hr' END, count(DISTINCT a.org_id)
        FROM org_addons a
        WHERE a.status = 'ACTIVE' AND a.paid_until > now()
          AND (a.code = 'STAFF_BUNDLE' OR a.code = 'ATTENDANCE' OR a.code LIKE 'ATTENDANCE\\_%')
          AND NOT EXISTS (SELECT 1 FROM promotion_redemptions r WHERE r.org_id = a.org_id AND r.addon_code = a.code AND r.paid_until >= a.paid_until)
        GROUP BY 1""")).all())
    b, h = rows.get("bundle", 0), rows.get("hr", 0)
    share = round(b / (b + h), 3) if b + h else 0.0
    return {"bundle": b, "hr_only": h, "bundle_share": share, "threshold": 0.6, "suggest_raise": b + h >= 10 and share > 0.6,
            "suggested_bundle_price": 229}
