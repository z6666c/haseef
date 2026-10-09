"""التسجيل الذاتي: منشأة جديدة بتجربة مجانية 14 يوماً بلا بطاقة، وتحقق البريد، ومعالج الإعداد عند أول دخول.

حماية: حد 5 تسجيلات لكل عنوان IP في الساعة، وحقل مصيدة للبرامج الآلية، وسجل تجاري فريد،
وكلمة مرور 10 أحرف على الأقل، وموافقة صريحة على الشروط ومعالجة البيانات.
"""

from __future__ import annotations

import hashlib
import ipaddress
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text

from ..config import get_settings
from ..db import platform_tx
from ..deps import Principal, Tenant, get_principal, get_tenant
from ..messaging import build_senders
from ..security import hash_password, issue_token
from ..services import governance_service as gs
from ..services import labor_service, tax_service

router = APIRouter(tags=["signup"])
TRIAL_DAYS = 14
MAX_PER_IP_HOUR = 5
LegalType = Literal["LLC", "SOLE_PROPRIETORSHIP", "CLOSED_JOINT_STOCK", "SIMPLIFIED_JOINT_STOCK", "PUBLIC_JOINT_STOCK", "BRANCH_OF_FOREIGN"]


def _hash(t: str) -> str:
    return hashlib.sha256(t.encode()).hexdigest()


def _send_verification(c, user_id, full_name: str, org_name: str, email: str) -> None:
    token = secrets.token_urlsafe(32)
    c.execute(text("""INSERT INTO email_verifications (token_hash, user_id, expires_at) VALUES (:h, :u, now() + interval '48 hours')"""),
              {"h": _hash(token), "u": user_id})
    link = f"{get_settings().client_base_url}/verify/?token={token}"
    try:
        build_senders(get_settings())["EMAIL"].send(email, "haseef_verify_email", [full_name, org_name, link])
    except Exception:
        pass                                 # يمكن إعادة الإرسال من داخل المنصة


class SignupIn(BaseModel):
    company_name: str = Field(min_length=2, max_length=255)
    cr_number: str = Field(pattern=r"^\d{10}$")
    entity_legal_type: LegalType
    full_name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    phone_number: str | None = Field(None, pattern=r"^\+9665\d{8}$")
    password: str = Field(min_length=10, max_length=256)
    plan_tier: Literal["ESSENTIAL", "PROFESSIONAL_GRC", "ENTERPRISE"] = "PROFESSIONAL_GRC"
    consent: bool
    website: str | None = None              # مصيدة: يتركها الإنسان فارغة


@router.post("/public/signup", status_code=201)
def signup(body: SignupIn, request: Request):
    if not get_settings().signup_enabled:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "التسجيل الذاتي متوقف حالياً. اطلب تجربة من صفحة حصيف.")
    if not body.consent:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "يلزم الموافقة على الشروط وسياسة الخصوصية")
    if body.website:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "تعذّر التسجيل")
    # خلف البوابة (Caddy) يأتي عنوان العميل في X-Forwarded-For الذي تضبطه البوابة نفسها
    ip = (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
          or (request.client.host if request.client else None)) or None
    try:
        ip = str(ipaddress.ip_address(ip)) if ip else None
    except ValueError:
        ip = None
    with platform_tx() as c:
        if ip and c.execute(text("""SELECT count(*) FROM audit_log WHERE action = 'SELF_SIGNUP' AND ip_address = CAST(:ip AS inet)
                                    AND created_at > now() - interval '1 hour'"""), {"ip": ip}).scalar_one() >= MAX_PER_IP_HOUR:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "محاولات تسجيل كثيرة. حاول لاحقاً.")
        if c.execute(text("SELECT 1 FROM organizations WHERE cr_number = :cr"), {"cr": body.cr_number}).first():
            raise HTTPException(status.HTTP_409_CONFLICT, "هذا السجل التجاري مسجّل في حصيف. اطلب من مدير منشأتك دعوتك، أو تواصل معنا.")
        if c.execute(text("SELECT 1 FROM users WHERE email = :e"), {"e": body.email}).first():
            raise HTTPException(status.HTTP_409_CONFLICT, "البريد مسجّل مسبقاً. سجّل الدخول بدلاً من ذلك.")
        org_id = c.execute(text("""
            INSERT INTO organizations (cr_number, name, entity_legal_type, signup_source) VALUES (:cr, :n, :t, 'SELF') RETURNING id"""),
            {"cr": body.cr_number, "n": body.company_name, "t": body.entity_legal_type}).scalar_one()
        now = datetime.now(timezone.utc)
        sub_id = c.execute(text("""
            INSERT INTO subscriptions (org_id, plan_tier, billing_cycle, starts_at, ends_at, billing_status)
            VALUES (:o, :t, 'MONTHLY', :s, :e, 'TRIAL') RETURNING id"""),
            {"o": org_id, "t": body.plan_tier, "s": now, "e": now + timedelta(days=TRIAL_DAYS)}).scalar_one()
        c.execute(text("""INSERT INTO billing_events (org_id, subscription_id, event_type, plan_tier, note)
                          VALUES (:o, :s, 'TRIAL_STARTED', :t, :n)"""),
                  {"o": org_id, "s": sub_id, "t": body.plan_tier, "n": f"تسجيل ذاتي — {TRIAL_DAYS} يوماً"})
        uid = c.execute(text("""
            INSERT INTO users (email, full_name, phone_number, password_hash, must_change_password)
            VALUES (:e, :n, :p, :h, false) RETURNING id"""),
            {"e": body.email, "n": body.full_name, "p": body.phone_number, "h": hash_password(body.password)}).scalar_one()
        c.execute(text("INSERT INTO memberships (org_id, user_id, role) VALUES (:o, :u, 'ORG_ADMIN')"), {"o": org_id, "u": uid})
        gs.apply_template(c, org_id)
        gs.sync_obligations(c, org_id)
        c.execute(text("""INSERT INTO audit_log (org_id, actor_user_id, action, entity_type, entity_id, changes, ip_address)
                          VALUES (:o, :u, 'SELF_SIGNUP', 'organization', :o, CAST(:c AS jsonb), CAST(:ip AS inet))"""),
                  {"o": org_id, "u": uid, "ip": ip,
                   "c": json.dumps({"name": body.company_name, "cr_number": body.cr_number, "plan": body.plan_tier}, ensure_ascii=False)})
        _send_verification(c, uid, body.full_name, body.company_name, body.email)
    return {"access_token": issue_token(str(uid), is_platform_admin=False), "org_id": org_id, "trial_days": TRIAL_DAYS}


class VerifyIn(BaseModel):
    token: str = Field(min_length=10, max_length=100)


@router.post("/public/verify-email")
def verify_email(body: VerifyIn):
    with platform_tx() as c:
        row = c.execute(text("""SELECT user_id FROM email_verifications WHERE token_hash = :h AND used_at IS NULL AND expires_at > now()"""),
                        {"h": _hash(body.token)}).mappings().one_or_none()
        if row is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "الرابط غير صالح أو منتهي. اطلب رابطاً جديداً من داخل المنصة.")
        c.execute(text("UPDATE email_verifications SET used_at = now() WHERE token_hash = :h"), {"h": _hash(body.token)})
        c.execute(text("UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = :u"), {"u": row["user_id"]})
    return {"verified": True}


@router.post("/auth/resend-verification")
def resend(p: Principal = Depends(get_principal)):
    with platform_tx() as c:
        u = c.execute(text("""SELECT u.id, u.full_name, u.email::text AS email, u.email_verified_at, o.name AS org_name FROM users u
                              LEFT JOIN memberships m ON m.user_id = u.id LEFT JOIN organizations o ON o.id = m.org_id
                              WHERE u.id = :u LIMIT 1"""), {"u": p.user_id}).mappings().one()
        if u["email_verified_at"]:
            return {"verified": True}
        recent = c.execute(text("""SELECT count(*) FROM email_verifications WHERE user_id = :u AND created_at > now() - interval '10 minutes'"""),
                           {"u": p.user_id}).scalar_one()
        if recent >= 3:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "أرسلنا عدة روابط للتو. انتظر قليلاً.")
        _send_verification(c, u["id"], u["full_name"], u["org_name"] or "منشأتك", u["email"])
    return {"sent": True}


# ---------------------------------------------------------------- معالج الإعداد
@router.get("/onboarding")
def onboarding_state(t: Tenant = Depends(get_tenant)):
    with platform_tx() as c:
        o = c.execute(text("""SELECT o.name, o.entity_legal_type, o.commercial_size, o.industry_type, o.onboarded_at, o.signup_source,
                                     u.email_verified_at, u.phone_number, s.plan_tier, s.billing_status, s.ends_at
                              FROM organizations o JOIN users u ON u.id = :u
                              LEFT JOIN subscriptions s ON s.org_id = o.id AND s.billing_status IN ('TRIAL','ACTIVE','PAST_DUE')
                              WHERE o.id = :o"""), {"o": t.org_id, "u": t.principal.user_id}).mappings().one()
    return {**dict(o), "needs_onboarding": o["onboarded_at"] is None and t.role == "ORG_ADMIN",
            "email_verified": o["email_verified_at"] is not None}


class OnboardingIn(BaseModel):
    commercial_size: Literal["MICRO", "SMALL", "MEDIUM"]
    industry_type: str | None = Field(None, max_length=100)
    employees_count: int = Field(0, ge=0, le=100000)
    labor_enabled: bool = True
    salary_day: int = Field(27, ge=1, le=28)
    vat_registered: bool = False
    vat_frequency: Literal["MONTHLY", "QUARTERLY"] = "QUARTERLY"
    withholding_applies: bool = False
    fiscal_year_end_month: int = Field(12, ge=1, le=12)
    alert_phone: str | None = Field(None, pattern=r"^\+9665\d{8}$")


@router.post("/onboarding")
def complete_onboarding(body: OnboardingIn, t: Tenant = Depends(get_tenant)):
    t.require("ORG_ADMIN")
    c = t.conn
    today = gs.riyadh_today()
    c.execute(text("""INSERT INTO org_governance_profiles (org_id, employees_count, vat_registered, fiscal_year_end_month)
                      VALUES (:o, :n, :v, :m) ON CONFLICT (org_id) DO UPDATE SET employees_count = EXCLUDED.employees_count,
                      vat_registered = EXCLUDED.vat_registered, fiscal_year_end_month = EXCLUDED.fiscal_year_end_month"""),
              {"o": t.org_id, "n": body.employees_count, "v": body.vat_registered, "m": body.fiscal_year_end_month})
    if body.labor_enabled:
        c.execute(text("""INSERT INTO labor_profiles (org_id, salary_day) VALUES (:o, :d)
                          ON CONFLICT (org_id) DO UPDATE SET salary_day = EXCLUDED.salary_day"""), {"o": t.org_id, "d": body.salary_day})
        labor_service.ensure_tasks(c, t.org_id, today)
    c.execute(text("""INSERT INTO tax_profiles (org_id, vat_registered, vat_frequency, withholding_applies, fiscal_year_end_month)
                      VALUES (:o, :v, :f, :w, :m) ON CONFLICT (org_id) DO UPDATE SET vat_registered = EXCLUDED.vat_registered,
                      vat_frequency = EXCLUDED.vat_frequency, withholding_applies = EXCLUDED.withholding_applies,
                      fiscal_year_end_month = EXCLUDED.fiscal_year_end_month, updated_at = now()"""),
              {"o": t.org_id, "v": body.vat_registered, "f": body.vat_frequency, "w": body.withholding_applies, "m": body.fiscal_year_end_month})
    tax_service.ensure_tasks(c, t.org_id, today)
    with platform_tx() as pc:                # المنشأة والمستخدم جدولا منصة
        pc.execute(text("UPDATE organizations SET commercial_size = :s, industry_type = :i, onboarded_at = now() WHERE id = :o"),
                   {"s": body.commercial_size, "i": body.industry_type, "o": t.org_id})
        if body.alert_phone:
            pc.execute(text("UPDATE users SET phone_number = :p WHERE id = :u"), {"p": body.alert_phone, "u": t.principal.user_id})
    gs.sync_obligations(c, t.org_id)
    c.execute(text("""INSERT INTO audit_log (org_id, actor_user_id, action, entity_type, entity_id, changes)
                      VALUES (:o, :u, 'ONBOARDING_DONE', 'organization', :o, CAST(:c AS jsonb))"""),
              {"o": t.org_id, "u": t.principal.user_id, "c": json.dumps(body.model_dump(), ensure_ascii=False)})
    return {"ok": True}
