"""طلبات التجربة من الصفحة التسويقية: إرسال عام بلا دخول، ومتابعة من غرفة العمليات.

الحماية من الإساءة: حقل مصيدة مخفي (honeypot)، وحد طلبات لكل بريد يومياً، وحد عام بالساعة.
لا تُرجع الواجهة العامة أي بيانات مخزنة.
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text

from ..db import platform_tx
from ..deps import Admin, require_perm

router = APIRouter(tags=["trials"])

PER_EMAIL_PER_DAY = 3
GLOBAL_PER_HOUR = 200


class TrialIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    company_name: str = Field(min_length=2, max_length=200)
    email: EmailStr
    phone_number: str | None = Field(default=None, pattern=r"^\+?9665\d{8}$|^05\d{8}$")
    legal_type: Literal["SOLE_PROPRIETORSHIP", "LLC", "SIMPLIFIED_JOINT_STOCK", "CLOSED_JOINT_STOCK",
                        "PUBLIC_JOINT_STOCK", "BRANCH_OF_FOREIGN", "OTHER"] | None = None
    employees_range: Literal["1-9", "10-49", "50-249", "250+"] | None = None
    plan_interest: Literal["ESSENTIAL", "PROFESSIONAL_GRC", "ENTERPRISE", "UNSURE"] = "UNSURE"
    interests: list[Literal["LICENSES", "GOVERNANCE", "PDPL", "POLICIES", "LEGAL", "GROUP"]] = Field(default_factory=list, max_length=6)
    message: str | None = Field(default=None, max_length=2000)
    source: str | None = Field(default=None, max_length=60)
    consent: bool
    website: str | None = None          # مصيدة: الحقل مخفي عن البشر


@router.post("/public/trial-requests", status_code=202)
def submit_trial(body: TrialIn, request: Request):
    if not body.consent:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "يلزم الموافقة على التواصل ومعالجة البيانات")
    if body.website:                    # روبوت: نرد بنجاح دون حفظ
        return {"received": True}
    phone = body.phone_number
    if phone and phone.startswith("05"):
        phone = "+966" + phone[1:]
    with platform_tx() as c:
        if c.execute(text("SELECT count(*) FROM trial_requests WHERE created_at > now() - interval '1 hour'")).scalar_one() >= GLOBAL_PER_HOUR:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "عدد كبير من الطلبات الآن، حاول بعد قليل")
        if c.execute(text("""SELECT count(*) FROM trial_requests WHERE email = :e AND created_at > now() - interval '1 day'"""),
                     {"e": body.email}).scalar_one() >= PER_EMAIL_PER_DAY:
            return {"received": True}   # لا نكشف أن البريد مسجل
        c.execute(text("""
            INSERT INTO trial_requests (full_name, company_name, email, phone_number, legal_type, employees_range,
                                        plan_interest, interests, message, source, consent)
            VALUES (:full_name, :company_name, :email, :phone, :legal_type, :employees_range, :plan_interest,
                    :interests, :message, :source, true)"""),
            {**body.model_dump(exclude={"website", "consent", "phone_number"}), "phone": phone,
             "source": (body.source or request.headers.get("referer", ""))[:60] or None})
    return {"received": True}


@router.get("/admin/trial-requests")
def list_trials(a: Admin = Depends(require_perm("trials.manage"))):
    rows = a.conn.execute(text("""
        SELECT t.id, t.full_name, t.company_name, t.email::text AS email, t.phone_number, t.legal_type, t.employees_range,
               t.plan_interest, t.interests, t.message, t.source, t.status, t.notes, t.created_at, t.updated_at,
               u.full_name AS handled_by_name
        FROM trial_requests t LEFT JOIN users u ON u.id = t.handled_by
        ORDER BY (t.status = 'NEW') DESC, t.created_at DESC LIMIT 500""")).mappings()
    return [dict(r) for r in rows]


class TrialUpdate(BaseModel):
    status: Literal["NEW", "CONTACTED", "CONVERTED", "REJECTED"]
    notes: str | None = Field(default=None, max_length=2000)


@router.patch("/admin/trial-requests/{trial_id}")
def update_trial(trial_id: UUID, body: TrialUpdate, a: Admin = Depends(require_perm("trials.manage"))):
    n = a.conn.execute(text("""UPDATE trial_requests SET status = :s, notes = :n, handled_by = :u, updated_at = now()
                               WHERE id = :id"""), {"s": body.status, "n": body.notes, "u": a.user_id, "id": trial_id}).rowcount
    if not n:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الطلب غير موجود")
    a.audit("ADMIN_TRIAL_STATUS", "trial_request", trial_id, None, {"status": body.status})
    return {"updated": True}
