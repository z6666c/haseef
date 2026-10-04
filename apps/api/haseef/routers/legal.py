"""الاستشارات القانونية بالساعة: العميل يرى التسعيرة ويطلب ويلغي؛ فريق حصيف يعيّن ويؤكد ويسجل الدفع.

صلاحيات الفريق:
  * الدعم الفني: تعيين المحامي والموعد، الإكمال، الإلغاء.
  * المحاسبة: تسجيل الدفع والاسترداد، وتعديل التسعيرة.
  * المدير العام: كل ما سبق + إدارة المحامين.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from ..deps import WRITERS, Admin, Tenant, get_tenant, require_perm
from ..domain.legal_pricing import ALLOWED_MINUTES, PLAN_DISCOUNT_PCT, URGENT_PCT, VAT_PCT, quote
from ..services import invoicing
from .compliance import _audit

router = APIRouter(tags=["legal"])

Mode = Literal["VIDEO", "PHONE", "IN_PERSON"]


def _plan(conn, org_id) -> str | None:
    return conn.execute(text("""SELECT plan_tier FROM subscriptions WHERE org_id = :o
                                AND billing_status IN ('TRIAL','ACTIVE','PAST_DUE')"""), {"o": org_id}).scalar_one_or_none()


def _rate(conn, topic: str) -> Decimal:
    r = conn.execute(text("SELECT hourly_rate_sar FROM legal_rates WHERE topic = :t AND is_active"), {"t": topic}).scalar_one_or_none()
    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "المجال غير متاح")
    return Decimal(r)


# ------------------------------------------------------------------ العميل
@router.get("/legal/rates")
def rates(t: Tenant = Depends(get_tenant)):
    plan = _plan(t.conn, t.org_id)
    rows = t.conn.execute(text("""SELECT topic, title, description, tier, hourly_rate_sar FROM legal_rates
                                  WHERE is_active ORDER BY sort""")).mappings().all()
    return {"rates": [dict(r) for r in rows], "durations": list(ALLOWED_MINUTES), "vat_pct": float(VAT_PCT),
            "urgent_pct": float(URGENT_PCT), "plan_tier": plan,
            "plan_discount_pct": float(PLAN_DISCOUNT_PCT.get(plan or "", Decimal("0")))}


class QuoteIn(BaseModel):
    topic: str
    duration_minutes: int
    urgent: bool = False


@router.post("/legal/quote")
def get_quote(body: QuoteIn, t: Tenant = Depends(get_tenant)):
    try:
        return quote(_rate(t.conn, body.topic), body.duration_minutes, urgent=body.urgent, plan_tier=_plan(t.conn, t.org_id)).as_dict()
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))


class BookIn(QuoteIn):
    subject: str = Field(min_length=3, max_length=255)
    details: str | None = Field(default=None, max_length=5000)
    mode: Mode = "VIDEO"
    preferred_at: datetime


_C_COLS = """c.id, c.topic, r.title AS topic_title, c.subject, c.details, c.duration_minutes, c.urgent, c.mode,
             c.preferred_at, c.price, c.total_sar, c.status, c.scheduled_at, c.meeting_link, c.payment_status,
             c.cancel_reason, c.lawyer_summary, c.created_at, l.full_name AS lawyer_name, l.license_number AS lawyer_license"""
_C_FROM = """FROM legal_consultations c JOIN legal_rates r ON r.topic = c.topic
             LEFT JOIN legal_lawyers l ON l.id = c.lawyer_id"""


@router.get("/legal/consultations")
def my_consultations(t: Tenant = Depends(get_tenant)):
    return [dict(r) for r in t.conn.execute(text(f"SELECT {_C_COLS} {_C_FROM} ORDER BY c.created_at DESC")).mappings()]


@router.post("/legal/consultations", status_code=201)
def book(body: BookIn, t: Tenant = Depends(get_tenant)):
    _ = WRITERS  # أي عضو فعّال يطلب استشارة لمنشأته؛ الطلب لا يُلزم مالياً قبل تأكيد الفريق
    now = datetime.now(timezone.utc)
    pref = body.preferred_at if body.preferred_at.tzinfo else body.preferred_at.replace(tzinfo=timezone.utc)
    if pref < now + timedelta(hours=2):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "اختر موعداً بعد ساعتين على الأقل من الآن")
    if body.urgent and pref > now + timedelta(hours=48):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "الاستشارة العاجلة تكون خلال 48 ساعة")
    try:
        q = quote(_rate(t.conn, body.topic), body.duration_minutes, urgent=body.urgent, plan_tier=_plan(t.conn, t.org_id))
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))
    cid = t.conn.execute(text("""
        INSERT INTO legal_consultations (org_id, requested_by, topic, subject, details, duration_minutes, urgent, mode,
                                         preferred_at, price, total_sar)
        VALUES (:o, :u, :topic, :subject, :details, :duration_minutes, :urgent, :mode, :pref, CAST(:price AS jsonb), :total)
        RETURNING id"""), {**body.model_dump(exclude={"preferred_at"}), "pref": pref, "o": t.org_id, "u": t.principal.user_id,
                            "price": json.dumps(q.as_dict()), "total": q.total}).scalar_one()
    _audit(t.conn, t, "LEGAL_BOOK", "legal_consultation", cid, {"topic": body.topic, "minutes": body.duration_minutes, "total": float(q.total)})
    return {"id": cid, "total_sar": float(q.total)}


class CancelIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


@router.post("/legal/consultations/{cid}/cancel")
def cancel_mine(cid: UUID, body: CancelIn, t: Tenant = Depends(get_tenant)):
    row = t.conn.execute(text("SELECT status, scheduled_at FROM legal_consultations WHERE id = :id"), {"id": cid}).one_or_none()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الطلب غير موجود")
    if row.status not in ("REQUESTED", "CONFIRMED"):
        raise HTTPException(status.HTTP_409_CONFLICT, "لا يمكن إلغاء هذا الطلب")
    if row.status == "CONFIRMED" and row.scheduled_at and row.scheduled_at < datetime.now(timezone.utc) + timedelta(hours=24):
        raise HTTPException(status.HTTP_409_CONFLICT, "لا يُلغى الموعد المؤكد قبل أقل من 24 ساعة. تواصل مع فريق حصيف.")
    t.conn.execute(text("UPDATE legal_consultations SET status = 'CANCELED', cancel_reason = :r, updated_at = now() WHERE id = :id"),
                   {"r": body.reason, "id": cid})
    _audit(t.conn, t, "LEGAL_CANCEL", "legal_consultation", cid, {"reason": body.reason})
    return {"status": "CANCELED"}


# ------------------------------------------------------------------ فريق حصيف
@router.get("/admin/legal/consultations")
def admin_list(a: Admin = Depends(require_perm("legal.cases", "legal.billing"))):
    rows = a.conn.execute(text(f"""SELECT {_C_COLS}, c.lawyer_id, c.payment_reference, o.name AS org_name, o.id AS org_id,
                                          u.full_name AS requested_by_name
                                   {_C_FROM} JOIN organizations o ON o.id = c.org_id
                                   LEFT JOIN users u ON u.id = c.requested_by
                                   ORDER BY (c.status IN ('COMPLETED','CANCELED')), c.preferred_at""")).mappings().all()
    out = [dict(r) for r in rows]
    if not a.can("legal.cases"):                # بلا صلاحية القضايا: بلا تفاصيلها
        for r in out:
            r["details"] = None
            r["lawyer_summary"] = None
    return out


class AssignIn(BaseModel):
    lawyer_id: UUID
    scheduled_at: datetime
    meeting_link: str | None = Field(default=None, max_length=500)


@router.post("/admin/legal/consultations/{cid}/assign")
def assign(cid: UUID, body: AssignIn, a: Admin = Depends(require_perm("legal.cases"))):
    if not a.conn.execute(text("SELECT 1 FROM legal_lawyers WHERE id = :l AND is_active"), {"l": body.lawyer_id}).scalar_one_or_none():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "المحامي غير متاح")
    n = a.conn.execute(text("""UPDATE legal_consultations SET lawyer_id = :l, scheduled_at = :s, meeting_link = :m,
                                   status = 'CONFIRMED', updated_at = now()
                               WHERE id = :id AND status IN ('REQUESTED','CONFIRMED')"""),
                       {"l": body.lawyer_id, "s": body.scheduled_at, "m": body.meeting_link, "id": cid}).rowcount
    if not n:
        raise HTTPException(status.HTTP_409_CONFLICT, "لا يمكن تأكيد هذا الطلب")
    a.audit("ADMIN_LEGAL_ASSIGN", "legal_consultation", cid, None, {"lawyer_id": str(body.lawyer_id), "scheduled_at": body.scheduled_at})
    return {"status": "CONFIRMED"}


class CompleteIn(BaseModel):
    lawyer_summary: str | None = Field(default=None, max_length=5000)


@router.post("/admin/legal/consultations/{cid}/complete")
def complete(cid: UUID, body: CompleteIn, a: Admin = Depends(require_perm("legal.cases"))):
    n = a.conn.execute(text("""UPDATE legal_consultations SET status = 'COMPLETED', lawyer_summary = :s, updated_at = now()
                               WHERE id = :id AND status = 'CONFIRMED'"""), {"s": body.lawyer_summary, "id": cid}).rowcount
    if not n:
        raise HTTPException(status.HTTP_409_CONFLICT, "الاستشارة غير مؤكدة")
    a.audit("ADMIN_LEGAL_COMPLETE", "legal_consultation", cid)
    return {"status": "COMPLETED"}


@router.post("/admin/legal/consultations/{cid}/cancel")
def admin_cancel(cid: UUID, body: CancelIn, a: Admin = Depends(require_perm("legal.cases"))):
    n = a.conn.execute(text("""UPDATE legal_consultations SET status = 'CANCELED', cancel_reason = :r, updated_at = now()
                               WHERE id = :id AND status IN ('REQUESTED','CONFIRMED')"""), {"r": body.reason, "id": cid}).rowcount
    if not n:
        raise HTTPException(status.HTTP_409_CONFLICT, "لا يمكن إلغاء هذا الطلب")
    a.audit("ADMIN_LEGAL_CANCEL", "legal_consultation", cid, None, {"reason": body.reason})
    return {"status": "CANCELED"}


class PaymentIn(BaseModel):
    payment_status: Literal["PAID", "REFUNDED"]
    payment_reference: str = Field(min_length=2, max_length=100)


@router.post("/admin/legal/consultations/{cid}/payment")
def payment(cid: UUID, body: PaymentIn, a: Admin = Depends(require_perm("legal.billing"))):
    n = a.conn.execute(text("""UPDATE legal_consultations SET payment_status = :p, payment_reference = :r, updated_at = now()
                               WHERE id = :id"""), {"p": body.payment_status, "r": body.payment_reference, "id": cid}).rowcount
    if not n:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الطلب غير موجود")
    a.audit("ADMIN_LEGAL_PAYMENT", "legal_consultation", cid, None, body.model_dump())
    # الفاتورة عند الدفع، والإشعار الدائن عند الاسترداد
    invoice = None
    if body.payment_status == "PAID":
        invoice = invoicing.invoice_consultation(a.conn, consultation_id=cid, user_id=a.user_id, reference=body.payment_reference)
    else:
        inv_id = a.conn.execute(text("""SELECT id FROM invoices WHERE consultation_id = :c AND kind = 'INVOICE' AND status = 'ISSUED'"""),
                                {"c": cid}).scalar_one_or_none()
        if inv_id:
            invoice = invoicing.credit_note(a.conn, invoice_id=inv_id, reason=f"استرداد الاستشارة ({body.payment_reference})",
                                            user_id=a.user_id)
    return {"payment_status": body.payment_status,
            "invoice": {"id": invoice["id"], "number": invoice["number"]} if invoice else None}


@router.get("/admin/legal/rates")
def admin_rates(a: Admin = Depends(require_perm("legal.cases", "legal.billing"))):
    return [dict(r) for r in a.conn.execute(text("""SELECT topic, title, description, tier, hourly_rate_sar, is_active, sort, updated_at
                                                     FROM legal_rates ORDER BY sort""")).mappings()]


class RateIn(BaseModel):
    hourly_rate_sar: float = Field(gt=0, le=100_000)
    is_active: bool = True


@router.patch("/admin/legal/rates/{topic}")
def patch_rate(topic: str, body: RateIn, a: Admin = Depends(require_perm("legal.billing"))):
    n = a.conn.execute(text("""UPDATE legal_rates SET hourly_rate_sar = :r, is_active = :act, updated_by = :u, updated_at = now()
                               WHERE topic = :t"""), {"r": body.hourly_rate_sar, "act": body.is_active, "u": a.user_id, "t": topic}).rowcount
    if not n:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "المجال غير موجود")
    a.audit("ADMIN_LEGAL_RATE", "legal_rate", None, None, {"topic": topic, **body.model_dump()})
    return {"updated": True}


@router.get("/admin/legal/lawyers")
def lawyers(a: Admin = Depends(require_perm("legal.cases", "legal.lawyers"))):
    return [dict(r) for r in a.conn.execute(text("""SELECT id, full_name, license_number, specialties, bio, email::text AS email,
                                                            phone_number, is_active FROM legal_lawyers ORDER BY full_name""")).mappings()]


class LawyerIn(BaseModel):
    full_name: str = Field(min_length=3, max_length=150)
    license_number: str = Field(min_length=2, max_length=50)
    specialties: list[str] = Field(default_factory=list)
    bio: str | None = None
    email: str | None = None
    phone_number: str | None = Field(default=None, pattern=r"^\+9665\d{8}$")
    is_active: bool = True


@router.post("/admin/legal/lawyers", status_code=201)
def add_lawyer(body: LawyerIn, a: Admin = Depends(require_perm("legal.lawyers"))):
    if a.conn.execute(text("SELECT 1 FROM legal_lawyers WHERE license_number = :n"), {"n": body.license_number}).scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "رقم الترخيص مسجل لمحامٍ آخر")
    lid = a.conn.execute(text("""INSERT INTO legal_lawyers (full_name, license_number, specialties, bio, email, phone_number, is_active)
                                 VALUES (:full_name, :license_number, :specialties, :bio, :email, :phone_number, :is_active)
                                 RETURNING id"""), body.model_dump()).scalar_one()
    a.audit("ADMIN_LEGAL_LAWYER_ADD", "legal_lawyer", lid, None, {"name": body.full_name, "license": body.license_number})
    return {"id": lid}


@router.patch("/admin/legal/lawyers/{lid}")
def update_lawyer(lid: UUID, body: LawyerIn, a: Admin = Depends(require_perm("legal.lawyers"))):
    n = a.conn.execute(text("""UPDATE legal_lawyers SET full_name = :full_name, license_number = :license_number,
                                   specialties = :specialties, bio = :bio, email = :email, phone_number = :phone_number,
                                   is_active = :is_active WHERE id = :id"""), {**body.model_dump(), "id": lid}).rowcount
    if not n:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "المحامي غير موجود")
    a.audit("ADMIN_LEGAL_LAWYER_EDIT", "legal_lawyer", lid, None, {"name": body.full_name, "active": body.is_active})
    return {"updated": True}
