"""إجراءات فريق حصيف على المنشآت والاشتراكات والمستخدمين والفريق.

كل إجراء:
  * محصور بدور (require_admin) — المدير العام مسموح دائماً.
  * يُسجَّل في audit_log مع الفاعل وعنوانه.
  * الإجراءات الحساسة تتطلب سبباً مكتوباً.
كلمة المرور المؤقتة تُرجَع مرة واحدة فقط ولا تُخزَّن إلا مُجزّأة، ويُجبَر صاحبها على تغييرها.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import Connection, text

from ..deps import Admin, get_platform_admin, require_admin
from ..security import hash_password
from ..services.score_service import recompute

router = APIRouter(prefix="/admin", tags=["admin-actions"])

Tier = Literal["ESSENTIAL", "PROFESSIONAL_GRC", "ENTERPRISE"]
OrgRole = Literal["ORG_ADMIN", "COMPLIANCE_OFFICER", "DPO", "VIEWER", "EXTERNAL_ADVISOR"]
LegalType = Literal["LLC", "SOLE_PROPRIETORSHIP", "CLOSED_JOINT_STOCK", "SIMPLIFIED_JOINT_STOCK",
                    "PUBLIC_JOINT_STOCK", "BRANCH_OF_FOREIGN"]
PlatformRole = Literal["SUPER_ADMIN", "SUPPORT", "BILLING"]


def _temp_password() -> str:
    return secrets.token_urlsafe(9)


def _404(what: str = "المنشأة"):
    return HTTPException(status.HTTP_404_NOT_FOUND, f"لم يُعثر على {what}")


def _org_exists(c: Connection, org_id: UUID) -> dict:
    row = c.execute(text("SELECT id, name, suspended_at FROM organizations WHERE id = :o"), {"o": org_id}).mappings().one_or_none()
    if row is None:
        raise _404()
    return dict(row)


def _live_sub(c: Connection, org_id: UUID) -> dict | None:
    row = c.execute(text("""
        SELECT s.*, p.monthly_price_sar, p.yearly_price_sar FROM subscriptions s JOIN plans p ON p.tier = s.plan_tier
        WHERE s.org_id = :o AND s.billing_status IN ('TRIAL','ACTIVE','PAST_DUE')"""), {"o": org_id}).mappings().one_or_none()
    return dict(row) if row else None


def _billing_event(a: Admin, org_id, sub_id, event: str, **kw) -> None:
    a.conn.execute(text("""
        INSERT INTO billing_events (org_id, subscription_id, event_type, plan_tier, amount_sar, period_months, reference, note, actor_user_id)
        VALUES (:o, :s, :e, :tier, :amt, :months, :ref, :note, :u)"""),
        {"o": org_id, "s": sub_id, "e": event, "tier": kw.get("tier"), "amt": kw.get("amount"),
         "months": kw.get("months"), "ref": kw.get("reference"), "note": kw.get("note"), "u": a.user_id})


def _find_or_create_user(c: Connection, email: str, full_name: str, phone: str | None,
                         platform_role: str | None = None) -> tuple[UUID, str | None]:
    """يُرجع (معرّف المستخدم، كلمة مرور مؤقتة إن كان جديداً)."""
    existing = c.execute(text("SELECT id FROM users WHERE email = :e"), {"e": email}).scalar_one_or_none()
    if existing:
        return existing, None
    pw = _temp_password()
    uid = c.execute(text("""
        INSERT INTO users (email, full_name, phone_number, password_hash, must_change_password, platform_role, is_platform_admin)
        VALUES (:e, :n, :p, :h, true, :r, :a) RETURNING id"""),
        {"e": email, "n": full_name, "p": phone, "h": hash_password(pw), "r": platform_role,
         "a": platform_role is not None}).scalar_one()
    return uid, pw


# =====================================================================
# من أنا (لإظهار الأزرار المناسبة في الواجهة؛ الخادم يفرض الصلاحية على أي حال)
# =====================================================================
@router.get("/me")
def admin_me(a: Admin = Depends(require_admin("SUPPORT", "BILLING"))):
    return {"user_id": a.user_id, "role": a.role}


# =====================================================================
# المنشآت
# =====================================================================
class OrgCreateIn(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    cr_number: str = Field(pattern=r"^\d{10}$", description="السجل التجاري: 10 أرقام")
    entity_legal_type: LegalType
    industry_type: str | None = Field(default=None, max_length=100)
    commercial_size: Literal["MICRO", "SMALL", "MEDIUM"] | None = None
    plan_tier: Tier = "ESSENTIAL"
    trial_days: int = Field(default=14, ge=0, le=60)
    admin_email: EmailStr
    admin_full_name: str = Field(min_length=2, max_length=100)
    admin_phone: str | None = Field(default=None, pattern=r"^\+9665\d{8}$")


class OrgUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=255)
    entity_legal_type: LegalType | None = None
    industry_type: str | None = Field(default=None, max_length=100)
    commercial_size: Literal["MICRO", "SMALL", "MEDIUM"] | None = None


class ReasonIn(BaseModel):
    reason: str = Field(min_length=5, max_length=500)


@router.post("/organizations", status_code=201)
def create_org(body: OrgCreateIn, a: Admin = Depends(require_admin("SUPPORT"))):
    c = a.conn
    if c.execute(text("SELECT 1 FROM organizations WHERE cr_number = :cr"), {"cr": body.cr_number}).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "يوجد منشأة مسجلة بهذا السجل التجاري")
    org_id = c.execute(text("""
        INSERT INTO organizations (cr_number, name, entity_legal_type, industry_type, commercial_size)
        VALUES (:cr, :n, :t, :i, :s) RETURNING id"""),
        {"cr": body.cr_number, "n": body.name, "t": body.entity_legal_type, "i": body.industry_type,
         "s": body.commercial_size}).scalar_one()

    # بلا فترة تجريبية: لا اشتراك حتى تُسجَّل أول دفعة (التنبيهات متوقفة إلى ذلك الحين)
    if body.trial_days > 0:
        now = datetime.now(timezone.utc)
        sub_id = c.execute(text("""
            INSERT INTO subscriptions (org_id, plan_tier, billing_cycle, starts_at, ends_at, billing_status)
            VALUES (:o, :t, 'MONTHLY', :s, :e, 'TRIAL') RETURNING id"""),
            {"o": org_id, "t": body.plan_tier, "s": now, "e": now + timedelta(days=body.trial_days)}).scalar_one()
        _billing_event(a, org_id, sub_id, "TRIAL_STARTED", tier=body.plan_tier, note=f"{body.trial_days} يوم")

    uid, temp_pw = _find_or_create_user(c, body.admin_email, body.admin_full_name, body.admin_phone)
    c.execute(text("INSERT INTO memberships (org_id, user_id, role) VALUES (:o, :u, 'ORG_ADMIN')"), {"o": org_id, "u": uid})
    a.audit("ADMIN_CREATE_ORG", "organization", org_id, org_id,
            {"name": body.name, "cr_number": body.cr_number, "plan": body.plan_tier, "admin": body.admin_email})
    return {"id": org_id, "admin_user_id": uid, "temporary_password": temp_pw,
            "admin_existing_user": temp_pw is None}


@router.get("/organizations/{org_id}")
def org_detail(org_id: UUID, c: Connection = Depends(get_platform_admin)):
    org = c.execute(text("""
        SELECT id, name, cr_number, entity_legal_type, industry_type, commercial_size, haseef_score,
               score_breakdown, is_active, suspended_at, suspension_reason, created_at
        FROM organizations WHERE id = :o"""), {"o": org_id}).mappings().one_or_none()
    if org is None:
        raise _404()
    sub = _live_sub(c, org_id)
    members = c.execute(text("""
        SELECT m.id AS membership_id, m.role, m.is_active AS membership_active, m.receives_alerts,
               u.id AS user_id, u.full_name, u.email::text AS email, u.phone_number, u.is_active AS user_active,
               u.last_login_at, u.must_change_password, (u.platform_role IS NOT NULL) AS is_team_member
        FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.org_id = :o ORDER BY m.created_at"""), {"o": org_id}).mappings().all()
    billing = c.execute(text("""
        SELECT b.event_type, b.plan_tier, b.amount_sar, b.period_months, b.reference, b.note, b.created_at,
               u.full_name AS actor
        FROM billing_events b LEFT JOIN users u ON u.id = b.actor_user_id
        WHERE b.org_id = :o ORDER BY b.created_at DESC LIMIT 30"""), {"o": org_id}).mappings().all()
    counts = c.execute(text("""
        SELECT (SELECT count(*) FROM v_compliance_items WHERE org_id = :o) AS items,
               (SELECT count(*) FROM v_compliance_items WHERE org_id = :o AND status = 'EXPIRED') AS expired,
               (SELECT count(*) FROM internal_policies WHERE org_id = :o) AS policies"""), {"o": org_id}).mappings().one()
    return {"organization": dict(org), "subscription": sub, "members": [dict(m) for m in members],
            "billing": [dict(b) for b in billing], "counts": dict(counts)}


@router.patch("/organizations/{org_id}")
def update_org(org_id: UUID, body: OrgUpdateIn, a: Admin = Depends(require_admin("SUPPORT"))):
    _org_exists(a.conn, org_id)
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        return {"updated": False}
    sets = ", ".join(f"{k} = :{k}" for k in changes)    # المفاتيح من نموذج Pydantic، لا من المستخدم
    a.conn.execute(text(f"UPDATE organizations SET {sets} WHERE id = :o"), {**changes, "o": org_id})
    a.audit("ADMIN_UPDATE_ORG", "organization", org_id, org_id, changes)
    return {"updated": True}


@router.post("/organizations/{org_id}/suspend")
def suspend_org(org_id: UUID, body: ReasonIn, a: Admin = Depends(require_admin())):   # المدير العام فقط
    org = _org_exists(a.conn, org_id)
    if org["suspended_at"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "المنشأة معلّقة مسبقاً")
    a.conn.execute(text("UPDATE organizations SET suspended_at = now(), suspension_reason = :r WHERE id = :o"),
                   {"r": body.reason, "o": org_id})
    # إيقاف التنبيهات التي لم تُرسل بعد
    n = a.conn.execute(text("""UPDATE alert_dispatches SET status = 'CANCELED', skip_reason = 'ORG_SUSPENDED'
                               WHERE org_id = :o AND status = 'QUEUED'"""), {"o": org_id}).rowcount
    a.audit("ADMIN_SUSPEND_ORG", "organization", org_id, org_id, {"reason": body.reason, "canceled_alerts": n})
    return {"suspended": True, "canceled_alerts": n}


@router.post("/organizations/{org_id}/reactivate")
def reactivate_org(org_id: UUID, body: ReasonIn, a: Admin = Depends(require_admin())):
    org = _org_exists(a.conn, org_id)
    if not org["suspended_at"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "المنشأة غير معلّقة")
    a.conn.execute(text("UPDATE organizations SET suspended_at = NULL, suspension_reason = NULL WHERE id = :o"), {"o": org_id})
    a.audit("ADMIN_REACTIVATE_ORG", "organization", org_id, org_id, {"reason": body.reason})
    return {"suspended": False}


# =====================================================================
# الاشتراكات
# =====================================================================
class ChangePlanIn(BaseModel):
    plan_tier: Tier
    note: str | None = Field(default=None, max_length=500)


class ExtendTrialIn(BaseModel):
    days: int = Field(ge=1, le=60)


class PaymentIn(BaseModel):
    amount_sar: float = Field(gt=0, le=1_000_000)
    billing_cycle: Literal["MONTHLY", "YEARLY"]
    plan_tier: Tier | None = None          # مطلوب فقط إن لم يكن هناك اشتراك قائم
    reference: str | None = Field(default=None, max_length=100)
    note: str | None = Field(default=None, max_length=500)


@router.post("/organizations/{org_id}/subscription/change-plan")
def change_plan(org_id: UUID, body: ChangePlanIn, a: Admin = Depends(require_admin("BILLING"))):
    _org_exists(a.conn, org_id)
    sub = _live_sub(a.conn, org_id)
    if sub is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "لا يوجد اشتراك قائم. سجّل دفعة لبدء اشتراك جديد.")
    if sub["plan_tier"] == body.plan_tier:
        raise HTTPException(status.HTTP_409_CONFLICT, "المنشأة على هذه الباقة أصلاً")
    a.conn.execute(text("UPDATE subscriptions SET plan_tier = :t WHERE id = :s"), {"t": body.plan_tier, "s": sub["id"]})
    _billing_event(a, org_id, sub["id"], "PLAN_CHANGED", tier=body.plan_tier,
                   note=f"من {sub['plan_tier']}" + (f" — {body.note}" if body.note else ""))
    a.audit("ADMIN_CHANGE_PLAN", "subscription", sub["id"], org_id, {"from": sub["plan_tier"], "to": body.plan_tier})
    recompute(a.conn, org_id)       # أركان المؤشر تتبع ميزات الباقة
    return {"plan_tier": body.plan_tier}


@router.post("/organizations/{org_id}/subscription/extend-trial")
def extend_trial(org_id: UUID, body: ExtendTrialIn, a: Admin = Depends(require_admin("BILLING", "SUPPORT"))):
    _org_exists(a.conn, org_id)
    sub = _live_sub(a.conn, org_id)
    if sub is None or sub["billing_status"] != "TRIAL":
        raise HTTPException(status.HTTP_409_CONFLICT, "المنشأة ليست في فترة تجريبية")
    new_end = a.conn.execute(text("""UPDATE subscriptions SET ends_at = GREATEST(ends_at, now()) + make_interval(days => :d)
                                     WHERE id = :s RETURNING ends_at"""), {"d": body.days, "s": sub["id"]}).scalar_one()
    _billing_event(a, org_id, sub["id"], "TRIAL_EXTENDED", note=f"{body.days} يوم")
    a.audit("ADMIN_EXTEND_TRIAL", "subscription", sub["id"], org_id, {"days": body.days, "ends_at": new_end})
    return {"ends_at": new_end}


@router.post("/organizations/{org_id}/subscription/payment")
def record_payment(org_id: UUID, body: PaymentIn, a: Admin = Depends(require_admin("BILLING"))):
    _org_exists(a.conn, org_id)
    months = 12 if body.billing_cycle == "YEARLY" else 1
    sub = _live_sub(a.conn, org_id)
    if sub is None:
        if body.plan_tier is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "اختر الباقة لبدء اشتراك جديد")
        sub_id = a.conn.execute(text("""
            INSERT INTO subscriptions (org_id, plan_tier, billing_cycle, starts_at, ends_at, billing_status)
            VALUES (:o, :t, :c, now(), now() + make_interval(months => :m), 'ACTIVE') RETURNING id"""),
            {"o": org_id, "t": body.plan_tier, "c": body.billing_cycle, "m": months}).scalar_one()
        tier = body.plan_tier
    else:
        sub_id, tier = sub["id"], body.plan_tier or sub["plan_tier"]
        # التجربة تنتهي فوراً عند أول دفعة؛ الاشتراك الساري يُمدَّد من نهايته.
        a.conn.execute(text("""
            UPDATE subscriptions SET
                billing_status = 'ACTIVE', billing_cycle = :c, plan_tier = :t,
                starts_at = CASE WHEN billing_status = 'TRIAL' THEN now() ELSE starts_at END,
                ends_at = CASE WHEN billing_status = 'TRIAL' THEN now() ELSE GREATEST(ends_at, now()) END
                          + make_interval(months => :m)
            WHERE id = :s"""), {"c": body.billing_cycle, "t": tier, "m": months, "s": sub_id})
    _billing_event(a, org_id, sub_id, "PAYMENT", tier=tier, amount=body.amount_sar, months=months,
                   reference=body.reference, note=body.note)
    a.audit("ADMIN_RECORD_PAYMENT", "subscription", sub_id, org_id,
            {"amount_sar": body.amount_sar, "cycle": body.billing_cycle, "reference": body.reference})
    recompute(a.conn, org_id)
    return {"subscription_id": sub_id, "status": "ACTIVE"}


@router.post("/organizations/{org_id}/subscription/cancel")
def cancel_subscription(org_id: UUID, body: ReasonIn, a: Admin = Depends(require_admin("BILLING"))):
    _org_exists(a.conn, org_id)
    sub = _live_sub(a.conn, org_id)
    if sub is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "لا يوجد اشتراك قائم")
    a.conn.execute(text("UPDATE subscriptions SET billing_status = 'CANCELED' WHERE id = :s"), {"s": sub["id"]})
    _billing_event(a, org_id, sub["id"], "CANCELED", note=body.reason)
    a.audit("ADMIN_CANCEL_SUBSCRIPTION", "subscription", sub["id"], org_id, {"reason": body.reason})
    return {"status": "CANCELED"}


# =====================================================================
# مستخدمو المنشآت
# =====================================================================
class InviteIn(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=100)
    phone_number: str | None = Field(default=None, pattern=r"^\+9665\d{8}$")
    role: OrgRole = "COMPLIANCE_OFFICER"


class MembershipUpdateIn(BaseModel):
    role: OrgRole | None = None
    is_active: bool | None = None


def _guard_team_target(a: Admin, user_id: UUID) -> dict:
    """الدعم الفني لا يمس حسابات فريق حصيف (يمنع تصعيد الصلاحيات)."""
    u = a.conn.execute(text("SELECT id, platform_role, email::text AS email FROM users WHERE id = :u"),
                       {"u": user_id}).mappings().one_or_none()
    if u is None:
        raise _404("المستخدم")
    if u["platform_role"] and a.role != "SUPER_ADMIN":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "حسابات فريق حصيف يديرها المدير العام فقط")
    return dict(u)


@router.post("/organizations/{org_id}/members", status_code=201)
def invite_member(org_id: UUID, body: InviteIn, a: Admin = Depends(require_admin("SUPPORT"))):
    _org_exists(a.conn, org_id)
    uid, temp_pw = _find_or_create_user(a.conn, body.email, body.full_name, body.phone_number)
    if a.conn.execute(text("SELECT 1 FROM memberships WHERE org_id = :o AND user_id = :u"), {"o": org_id, "u": uid}).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "هذا المستخدم عضو في المنشأة أصلاً")
    mid = a.conn.execute(text("INSERT INTO memberships (org_id, user_id, role) VALUES (:o, :u, :r) RETURNING id"),
                         {"o": org_id, "u": uid, "r": body.role}).scalar_one()
    a.audit("ADMIN_INVITE_MEMBER", "membership", mid, org_id, {"email": body.email, "role": body.role})
    return {"membership_id": mid, "user_id": uid, "temporary_password": temp_pw, "existing_user": temp_pw is None}


@router.patch("/memberships/{membership_id}")
def update_membership(membership_id: UUID, body: MembershipUpdateIn, a: Admin = Depends(require_admin("SUPPORT"))):
    m = a.conn.execute(text("SELECT org_id, user_id, role FROM memberships WHERE id = :m"), {"m": membership_id}).mappings().one_or_none()
    if m is None:
        raise _404("العضوية")
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    if not changes:
        return {"updated": False}
    # لا تُترك منشأة بلا مدير فعّال
    demoting = (changes.get("role") not in (None, "ORG_ADMIN")) or changes.get("is_active") is False
    if m["role"] == "ORG_ADMIN" and demoting:
        others = a.conn.execute(text("""SELECT count(*) FROM memberships WHERE org_id = :o AND role = 'ORG_ADMIN'
                                        AND is_active AND id <> :m"""), {"o": m["org_id"], "m": membership_id}).scalar_one()
        if others == 0:
            raise HTTPException(status.HTTP_409_CONFLICT, "لا يمكن: هذا آخر مدير فعّال في المنشأة. أضف مديراً آخر أولاً.")
    sets = ", ".join(f"{k} = :{k}" for k in changes)
    a.conn.execute(text(f"UPDATE memberships SET {sets} WHERE id = :m"), {**changes, "m": membership_id})
    a.audit("ADMIN_UPDATE_MEMBERSHIP", "membership", membership_id, m["org_id"], changes)
    return {"updated": True}


@router.post("/users/{user_id}/reset-password")
def reset_password(user_id: UUID, a: Admin = Depends(require_admin("SUPPORT"))):
    u = _guard_team_target(a, user_id)
    pw = _temp_password()
    a.conn.execute(text("UPDATE users SET password_hash = :h, must_change_password = true WHERE id = :u"),
                   {"h": hash_password(pw), "u": user_id})
    a.audit("ADMIN_RESET_PASSWORD", "user", user_id, None, {"email": u["email"]})
    return {"temporary_password": pw}


@router.post("/users/{user_id}/disable")
def disable_user(user_id: UUID, body: ReasonIn, a: Admin = Depends(require_admin("SUPPORT"))):
    u = _guard_team_target(a, user_id)
    if user_id == a.user_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "لا يمكنك تعطيل حسابك")
    a.conn.execute(text("UPDATE users SET is_active = false WHERE id = :u"), {"u": user_id})
    a.audit("ADMIN_DISABLE_USER", "user", user_id, None, {"email": u["email"], "reason": body.reason})
    return {"is_active": False}


@router.post("/users/{user_id}/enable")
def enable_user(user_id: UUID, a: Admin = Depends(require_admin("SUPPORT"))):
    u = _guard_team_target(a, user_id)
    a.conn.execute(text("UPDATE users SET is_active = true WHERE id = :u"), {"u": user_id})
    a.audit("ADMIN_ENABLE_USER", "user", user_id, None, {"email": u["email"]})
    return {"is_active": True}


# =====================================================================
# فريق حصيف (المدير العام فقط)
# =====================================================================
class TeamAddIn(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=100)
    role: PlatformRole


class TeamRoleIn(BaseModel):
    role: PlatformRole | None          # None = إزالة من الفريق


@router.get("/team")
def team(a: Admin = Depends(require_admin("SUPPORT", "BILLING"))):
    return [dict(r) for r in a.conn.execute(text("""
        SELECT id, full_name, email::text AS email, platform_role, is_active, last_login_at, must_change_password
        FROM users WHERE platform_role IS NOT NULL ORDER BY created_at""")).mappings()]


@router.post("/team", status_code=201)
def team_add(body: TeamAddIn, a: Admin = Depends(require_admin())):
    c = a.conn
    existing = c.execute(text("SELECT id, platform_role FROM users WHERE email = :e"), {"e": body.email}).mappings().one_or_none()
    if existing and existing["platform_role"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "هذا الشخص عضو في الفريق أصلاً")
    if existing:
        c.execute(text("UPDATE users SET platform_role = :r, is_platform_admin = true WHERE id = :u"),
                  {"r": body.role, "u": existing["id"]})
        uid, pw = existing["id"], None
    else:
        uid, pw = _find_or_create_user(c, body.email, body.full_name, None, platform_role=body.role)
    a.audit("ADMIN_TEAM_ADD", "user", uid, None, {"email": body.email, "role": body.role})
    return {"user_id": uid, "temporary_password": pw}


@router.patch("/team/{user_id}")
def team_role(user_id: UUID, body: TeamRoleIn, a: Admin = Depends(require_admin())):
    if user_id == a.user_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "لا يمكنك تغيير دورك بنفسك")
    current = a.conn.execute(text("SELECT platform_role FROM users WHERE id = :u"), {"u": user_id}).scalar_one_or_none()
    if current is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ليس عضواً في الفريق")
    if current == "SUPER_ADMIN" and body.role != "SUPER_ADMIN":
        left = a.conn.execute(text("""SELECT count(*) FROM users WHERE platform_role = 'SUPER_ADMIN'
                                      AND is_active AND id <> :u"""), {"u": user_id}).scalar_one()
        if left == 0:
            raise HTTPException(status.HTTP_409_CONFLICT, "لا يمكن: هذا آخر مدير عام")
    a.conn.execute(text("UPDATE users SET platform_role = :r, is_platform_admin = :a WHERE id = :u"),
                   {"r": body.role, "a": body.role is not None, "u": user_id})
    a.audit("ADMIN_TEAM_ROLE", "user", user_id, None, {"from": current, "to": body.role})
    return {"role": body.role}


# =====================================================================
# سجل التدقيق
# =====================================================================
@router.get("/audit")
def audit(org_id: UUID | None = None, limit: int = 100, c: Connection = Depends(get_platform_admin)):
    rows = c.execute(text("""
        SELECT l.id, l.created_at, l.action, l.entity_type, l.entity_id, l.changes, host(l.ip_address) AS ip,
               u.full_name AS actor, u.platform_role AS actor_role, o.name AS org_name, l.org_id
        FROM audit_log l
        LEFT JOIN users u ON u.id = l.actor_user_id
        LEFT JOIN organizations o ON o.id = l.org_id
        WHERE (CAST(:o AS uuid) IS NULL OR l.org_id = :o)
        ORDER BY l.created_at DESC LIMIT :l"""), {"o": org_id, "l": min(limit, 500)}).mappings()
    return [dict(r) for r in rows]
