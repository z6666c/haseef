"""إدارة بوت الموظفين من حصيف: التفعيل والإعدادات، الأعضاء والدعوات، الأسئلة الشائعة، السياسات المشتركة،
تجربة المحادثة، وتقرير الإقرارات. الإضافة مفعّلة عبر الباقة (مجاناً) أو باشتراك شهري (التسعير من غرفة العمليات).
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from ..config import get_settings
from ..db import platform_tx
from ..deps import Tenant, get_tenant
from ..messaging import build_senders
from ..services import bot_service, pricing
from .compliance import _audit

router = APIRouter(prefix="/bot", tags=["bot"])
MANAGERS = ("ORG_ADMIN", "COMPLIANCE_OFFICER")


def _ser(v):
    return v.isoformat() if isinstance(v, datetime) else v


def _access(t: Tenant) -> dict:
    return pricing.addon_access(t.conn, t.org_id, "WA_BOT")


def _need(t: Tenant, manage: bool = True) -> dict:
    a = _access(t)
    if not a["via"]:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, "بوت الموظفين غير مفعّل. اشترك فيه من صفحة «بوت الموظفين».")
    if manage:
        t.require(*MANAGERS)
    return a


@router.get("/overview")
def overview(t: Tenant = Depends(get_tenant)):
    c = t.conn
    a = _access(t)
    out = {"access": {k: _ser(v) for k, v in a.items()}, "can_manage": t.role in MANAGERS,
           "live": get_settings().whatsapp_provider == "meta"}
    if not a["via"]:
        return out
    s = bot_service.ensure_settings(c, t.org_id)
    members = [dict(r) for r in c.execute(text("""
        SELECT m.id, m.full_name, m.phone, m.status, m.joined_via, m.consent_at, m.created_at, m.employee_id,
               (SELECT count(*) FROM policy_acknowledgments a JOIN internal_policies p ON p.id = a.policy_id AND p.version = a.policy_version
                WHERE a.member_id = m.id) AS acks
        FROM bot_members m WHERE m.status <> 'REMOVED' ORDER BY m.status, m.full_name""")).mappings()]
    pols = [dict(r) for r in c.execute(text("""
        SELECT p.id, p.title, p.version, p.shared_with_employees, p.employee_summary,
               (SELECT count(*) FROM policy_acknowledgments a WHERE a.policy_id = p.id AND a.policy_version = p.version) AS acks
        FROM internal_policies p WHERE p.status = 'ACTIVE' ORDER BY p.title""")).mappings()]
    faqs = [dict(r) for r in c.execute(text("SELECT id, question, answer, is_active FROM bot_faqs ORDER BY created_at")).mappings()]
    employees = [dict(r) for r in c.execute(text("SELECT id, full_name FROM org_employees WHERE is_active ORDER BY full_name")).mappings()]
    log = [dict(r) for r in c.execute(text("""
        SELECT b.id, b.direction, b.body, b.intent, b.simulated, b.created_at, m.full_name
        FROM bot_messages b LEFT JOIN bot_members m ON m.id = b.member_id ORDER BY b.id DESC LIMIT 60""")).mappings()]
    unanswered = [dict(r) for r in c.execute(text("""
        SELECT i.body, i.created_at, m.full_name FROM bot_messages o
        JOIN LATERAL (SELECT body, created_at FROM bot_messages x WHERE x.member_id IS NOT DISTINCT FROM o.member_id AND x.direction = 'IN'
                      AND x.id < o.id ORDER BY x.id DESC LIMIT 1) i ON true
        LEFT JOIN bot_members m ON m.id = o.member_id
        WHERE o.intent = 'NO_ANSWER' AND NOT o.simulated ORDER BY o.id DESC LIMIT 20""")).mappings()]
    active = sum(1 for m in members if m["status"] == "ACTIVE")
    return {**out, "settings": {k: _ser(v) for k, v in s.items() if k != "org_id"},
            "members": [{k: _ser(v) for k, v in m.items()} for m in members], "policies": pols, "faqs": faqs, "employees": employees,
            "log": [{k: _ser(v) for k, v in m.items()} for m in log], "unanswered": [{k: _ser(v) for k, v in m.items()} for m in unanswered],
            "stats": {"members_active": active, "members_total": len(members),
                      "questions_month": bot_service.questions_this_month(c, t.org_id),
                      "shared_policies": sum(1 for p in pols if p["shared_with_employees"])}}


class SettingsIn(BaseModel):
    enabled: bool = True
    welcome_text: str | None = Field(None, max_length=500)
    hr_contact: str | None = Field(None, max_length=150)
    require_approval: bool = True


@router.put("/settings")
def save_settings(body: SettingsIn, t: Tenant = Depends(get_tenant)):
    _need(t)
    bot_service.ensure_settings(t.conn, t.org_id)
    t.conn.execute(text("""UPDATE bot_settings SET enabled = :enabled, welcome_text = :welcome_text, hr_contact = :hr_contact,
                           require_approval = :require_approval, updated_at = now()"""), body.model_dump())
    _audit(t.conn, t, "UPDATE", "bot_settings", None, body.model_dump())
    return {"ok": True}


@router.post("/invite-code/rotate")
def rotate_code(t: Tenant = Depends(get_tenant)):
    _need(t)
    bot_service.ensure_settings(t.conn, t.org_id)
    code = bot_service.new_code()
    t.conn.execute(text("UPDATE bot_settings SET invite_code = :c, updated_at = now()"), {"c": code})
    _audit(t.conn, t, "ROTATE", "bot_invite_code", None)
    return {"invite_code": code}


class MemberIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=150)
    phone: str = Field(pattern=r"^\+9665\d{8}$")
    employee_id: UUID | None = None


@router.post("/members", status_code=201)
def add_member(body: MemberIn, t: Tenant = Depends(get_tenant)):
    a = _need(t)
    c = t.conn
    limit = (a.get("limits") or {}).get("members")
    n = c.execute(text("SELECT count(*) FROM bot_members WHERE status <> 'REMOVED'")).scalar_one()
    if limit is not None and n >= limit:
        raise HTTPException(status.HTTP_409_CONFLICT, f"بلغت الحد ({limit} موظفاً) في اشتراكك الحالي")
    with platform_tx() as pc:                # الرقم فريد عبر كل المنشآت (البوت يعرف المنشأة من الرقم)
        if pc.execute(text("SELECT 1 FROM bot_members WHERE phone = :p AND status <> 'REMOVED'"), {"p": body.phone}).first():
            raise HTTPException(status.HTTP_409_CONFLICT, "هذا الرقم مسجّل في مساعد منشأة أخرى أو مضاف مسبقاً")
    mid = c.execute(text("""INSERT INTO bot_members (org_id, employee_id, full_name, phone, status, joined_via)
                            VALUES (:o, :e, :n, :p, 'INVITED', 'INVITE') RETURNING id"""),
                    {"o": t.org_id, "e": body.employee_id, "n": body.full_name, "p": body.phone}).scalar_one()
    org = c.execute(text("SELECT name FROM organizations")).scalar_one()
    try:
        build_senders(get_settings())["WHATSAPP"].send(body.phone, "haseef_bot_invite", [body.full_name.split()[0], org])
    except Exception:
        pass
    _audit(t.conn, t, "CREATE", "bot_member", mid, {"full_name": body.full_name})
    return {"id": mid}


@router.post("/members/{member_id}/approve")
def approve(member_id: UUID, t: Tenant = Depends(get_tenant)):
    _need(t)
    n = t.conn.execute(text("UPDATE bot_members SET status = 'ACTIVE', consent_at = COALESCE(consent_at, now()) WHERE id = :m AND status = 'PENDING'"),
                       {"m": member_id}).rowcount
    if not n:
        raise HTTPException(status.HTTP_409_CONFLICT, "لا يوجد طلب انضمام بانتظار الموافقة")
    _audit(t.conn, t, "APPROVE", "bot_member", member_id)
    return {"ok": True}


class MemberLinkIn(BaseModel):
    employee_id: UUID | None = None


@router.patch("/members/{member_id}")
def link_member(member_id: UUID, body: MemberLinkIn, t: Tenant = Depends(get_tenant)):
    """ربط رقم الموظف في البوت بسجله الوظيفي (يلزم لرابط الحضور)."""
    _need(t)
    if body.employee_id and not t.conn.execute(text("SELECT 1 FROM org_employees WHERE id = :e AND is_active"), {"e": body.employee_id}).first():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الموظف غير موجود")
    if not t.conn.execute(text("UPDATE bot_members SET employee_id = :e WHERE id = :m AND status <> 'REMOVED'"),
                          {"e": body.employee_id, "m": member_id}).rowcount:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "العضو غير موجود")
    _audit(t.conn, t, "LINK", "bot_member", member_id, {"employee_id": str(body.employee_id) if body.employee_id else None})
    return {"ok": True}


@router.delete("/members/{member_id}", status_code=204)
def remove(member_id: UUID, t: Tenant = Depends(get_tenant)):
    _need(t)
    t.conn.execute(text("UPDATE bot_members SET status = 'REMOVED' WHERE id = :m"), {"m": member_id})
    _audit(t.conn, t, "REMOVE", "bot_member", member_id)


class FaqIn(BaseModel):
    question: str = Field(min_length=3, max_length=300)
    answer: str = Field(min_length=2, max_length=2000)
    is_active: bool = True


@router.post("/faqs", status_code=201)
def add_faq(body: FaqIn, t: Tenant = Depends(get_tenant)):
    _need(t)
    fid = t.conn.execute(text("INSERT INTO bot_faqs (org_id, question, answer, is_active) VALUES (:o, :question, :answer, :is_active) RETURNING id"),
                         {**body.model_dump(), "o": t.org_id}).scalar_one()
    _audit(t.conn, t, "CREATE", "bot_faq", fid, {"question": body.question})
    return {"id": fid}


@router.put("/faqs/{faq_id}")
def edit_faq(faq_id: UUID, body: FaqIn, t: Tenant = Depends(get_tenant)):
    _need(t)
    if not t.conn.execute(text("UPDATE bot_faqs SET question = :question, answer = :answer, is_active = :is_active WHERE id = :id"),
                          {**body.model_dump(), "id": faq_id}).rowcount:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "السؤال غير موجود")
    return {"ok": True}


@router.delete("/faqs/{faq_id}", status_code=204)
def delete_faq(faq_id: UUID, t: Tenant = Depends(get_tenant)):
    _need(t)
    t.conn.execute(text("DELETE FROM bot_faqs WHERE id = :id"), {"id": faq_id})


class SharePolicyIn(BaseModel):
    shared: bool
    employee_summary: str | None = Field(None, max_length=1500)


@router.patch("/policies/{policy_id}")
def share_policy(policy_id: UUID, body: SharePolicyIn, t: Tenant = Depends(get_tenant)):
    _need(t)
    if not t.conn.execute(text("""UPDATE internal_policies SET shared_with_employees = :s, employee_summary = :m
                                  WHERE id = :id AND status = 'ACTIVE'"""),
                          {"s": body.shared, "m": body.employee_summary, "id": policy_id}).rowcount:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "السياسة غير موجودة أو غير معتمدة")
    _audit(t.conn, t, "SHARE" if body.shared else "UNSHARE", "policy", policy_id)
    return {"ok": True}


class SimIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    member_id: UUID | None = None


@router.post("/simulate")
def simulate(body: SimIn, t: Tenant = Depends(get_tenant)):
    _need(t)
    return bot_service.simulate(t.conn, t.org_id, member_id=body.member_id, body=body.text)


@router.get("/acknowledgments")
def acknowledgments(t: Tenant = Depends(get_tenant)):
    _need(t, manage=False)
    rows = t.conn.execute(text("""
        SELECT p.id AS policy_id, p.title, p.version, m.id AS member_id, m.full_name, a.acknowledged_at
        FROM internal_policies p CROSS JOIN bot_members m
        LEFT JOIN policy_acknowledgments a ON a.policy_id = p.id AND a.member_id = m.id AND a.policy_version = p.version
        WHERE p.status = 'ACTIVE' AND p.shared_with_employees AND m.status = 'ACTIVE' ORDER BY p.title, m.full_name""")).mappings()
    return [{k: _ser(v) for k, v in dict(r).items()} for r in rows]
