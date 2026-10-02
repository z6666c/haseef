"""حماية البيانات الشخصية: سجل أنشطة المعالجة، طلبات أصحاب البيانات، حوادث التسرب."""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text

from ..content.pdpl import ROPA_TEMPLATES
from ..deps import WRITERS, Tenant, get_tenant
from ..services import governance_service as gs
from .compliance import _audit

router = APIRouter(prefix="/pdpl", tags=["pdpl"])

NOTIFY_HOURS = 72          # مهلة إبلاغ الجهة المختصة من وقت العلم بالحادثة
REQUEST_DAYS = 30          # مهلة الرد على طلب صاحب البيانات (قابلة للتعديل لكل طلب)


def _write(t: Tenant) -> None:
    t.require(*WRITERS)


def _refresh(t: Tenant) -> None:
    gs.run_and_save(t.conn, t.org_id, t.principal.user_id)   # السجل يدخل في فحص الحوكمة والمؤشر


# ------------------------------------------------------------------ سجل أنشطة المعالجة
class RecordIn(BaseModel):
    activity_name: str = Field(min_length=2, max_length=255)
    purpose: str = Field(min_length=3)
    data_subjects: Literal["EMPLOYEES", "CUSTOMERS", "VENDORS", "APPLICANTS", "VISITORS", "OTHER"]
    data_categories: list[str] = Field(min_length=1, max_length=40)
    includes_sensitive_data: bool = False
    legal_basis: Literal["CONSENT", "CONTRACTUAL", "LEGAL_OBLIGATION", "VITAL_INTEREST", "PUBLIC_INTEREST", "LEGITIMATE_INTEREST"]
    owner_membership_id: UUID | None = None
    retention_period_months: int = Field(gt=0, le=600)
    storage_location: Literal["SAUDI_LOCAL_CLOUD", "ON_PREMISE", "FOREIGN_CLOUD"]
    cross_border_transfer: bool = False
    transfer_destination: str | None = None
    transfer_safeguard: str | None = None
    processors: list[str] = Field(default_factory=list, max_length=40)
    security_controls: str | None = None
    next_review_date: date | None = None

    @model_validator(mode="after")
    def _transfer(self) -> "RecordIn":
        if self.cross_border_transfer and not (self.transfer_destination and self.transfer_safeguard):
            raise ValueError("النقل خارج المملكة يتطلب تحديد الوجهة والأساس النظامي")
        if not self.cross_border_transfer:
            self.transfer_destination = self.transfer_safeguard = None
        return self


_REC_COLS = """r.id, r.activity_name, r.purpose, r.data_subjects, r.data_categories, r.includes_sensitive_data, r.legal_basis,
               r.owner_membership_id, u.full_name AS owner_name, r.retention_period_months, r.storage_location,
               r.cross_border_transfer, r.transfer_destination, r.transfer_safeguard, r.processors, r.security_controls,
               r.next_review_date, r.updated_at"""
_REC_FROM = """FROM pdpl_data_records r LEFT JOIN memberships m ON m.id = r.owner_membership_id
               LEFT JOIN users u ON u.id = m.user_id"""


def _rec_params(b: RecordIn, t: Tenant) -> dict:
    return {**b.model_dump(), "data_categories": json.dumps(b.data_categories, ensure_ascii=False),
            "processors": json.dumps(b.processors, ensure_ascii=False), "o": t.org_id}


@router.get("/records")
def records(t: Tenant = Depends(get_tenant)):
    return [dict(r) for r in t.conn.execute(text(f"SELECT {_REC_COLS} {_REC_FROM} ORDER BY r.activity_name")).mappings()]


@router.get("/owners")
def owners(t: Tenant = Depends(get_tenant)):
    """من يمكن تعيينه مسؤولاً عن نشاط معالجة: أعضاء المنشأة الفعّالون."""
    return [dict(r) for r in t.conn.execute(text("""
        SELECT m.id, u.full_name, m.role FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.is_active ORDER BY u.full_name""")).mappings()]


@router.get("/record-templates")
def record_templates():
    return [{"key": x["key"], "activity_name": x["activity_name"], "data_subjects": x["data_subjects"]} for x in ROPA_TEMPLATES]


@router.post("/records", status_code=201)
def add_record(body: RecordIn, t: Tenant = Depends(get_tenant)):
    _write(t)
    rid = t.conn.execute(text("""
        INSERT INTO pdpl_data_records (org_id, activity_name, purpose, data_subjects, data_categories, includes_sensitive_data,
            legal_basis, owner_membership_id, retention_period_months, storage_location, cross_border_transfer,
            transfer_destination, transfer_safeguard, processors, security_controls, next_review_date)
        VALUES (:o, :activity_name, :purpose, :data_subjects, CAST(:data_categories AS jsonb), :includes_sensitive_data,
            :legal_basis, :owner_membership_id, :retention_period_months, :storage_location, :cross_border_transfer,
            :transfer_destination, :transfer_safeguard, CAST(:processors AS jsonb), :security_controls, :next_review_date)
        RETURNING id"""), _rec_params(body, t)).scalar_one()
    _audit(t.conn, t, "PDPL_RECORD_ADD", "pdpl_record", rid, {"activity": body.activity_name})
    _refresh(t)
    return {"id": rid}


@router.post("/records/from-template/{key}", status_code=201)
def add_from_template(key: str, t: Tenant = Depends(get_tenant)):
    tpl = next((x for x in ROPA_TEMPLATES if x["key"] == key), None)
    if not tpl:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "النموذج غير موجود")
    owner = t.conn.execute(text("SELECT id FROM memberships WHERE user_id = :u AND is_active"),
                           {"u": t.principal.user_id}).scalar_one_or_none()
    body = RecordIn(**{k: v for k, v in tpl.items() if k != "key"}, owner_membership_id=owner,
                    next_review_date=gs.riyadh_today() + timedelta(days=365))
    return add_record(body, t)


@router.put("/records/{record_id}")
def update_record(record_id: UUID, body: RecordIn, t: Tenant = Depends(get_tenant)):
    _write(t)
    n = t.conn.execute(text("""
        UPDATE pdpl_data_records SET activity_name = :activity_name, purpose = :purpose, data_subjects = :data_subjects,
            data_categories = CAST(:data_categories AS jsonb), includes_sensitive_data = :includes_sensitive_data,
            legal_basis = :legal_basis, owner_membership_id = :owner_membership_id,
            retention_period_months = :retention_period_months, storage_location = :storage_location,
            cross_border_transfer = :cross_border_transfer, transfer_destination = :transfer_destination,
            transfer_safeguard = :transfer_safeguard, processors = CAST(:processors AS jsonb),
            security_controls = :security_controls, next_review_date = :next_review_date, updated_at = now()
        WHERE id = :id"""), {**_rec_params(body, t), "id": record_id}).rowcount
    if not n:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "النشاط غير موجود")
    _audit(t.conn, t, "PDPL_RECORD_EDIT", "pdpl_record", record_id, {"activity": body.activity_name})
    _refresh(t)
    return {"updated": True}


@router.delete("/records/{record_id}", status_code=204)
def delete_record(record_id: UUID, t: Tenant = Depends(get_tenant)):
    _write(t)
    if not t.conn.execute(text("DELETE FROM pdpl_data_records WHERE id = :id"), {"id": record_id}).rowcount:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "النشاط غير موجود")
    _audit(t.conn, t, "PDPL_RECORD_DELETE", "pdpl_record", record_id)
    _refresh(t)
    return Response(status_code=204)


# ------------------------------------------------------------------ طلبات أصحاب البيانات
class RequestIn(BaseModel):
    requester_name: str = Field(min_length=2, max_length=150)
    requester_contact: str | None = Field(default=None, max_length=150)
    request_type: Literal["ACCESS", "COPY", "CORRECTION", "DESTRUCTION", "WITHDRAW_CONSENT", "OBJECTION", "OTHER"]
    channel: Literal["EMAIL", "PHONE", "WEBSITE", "IN_PERSON", "OTHER"] = "EMAIL"
    details: str | None = None
    received_on: date
    due_on: date | None = None


class RequestUpdate(BaseModel):
    status: Literal["OPEN", "IN_PROGRESS", "COMPLETED", "REJECTED"]
    identity_verified: bool = False
    response_note: str | None = None
    due_on: date | None = None


_REQ_COLS = """id, requester_name, requester_contact, request_type, channel, details, received_on, due_on,
               identity_verified, status, response_note, completed_on, created_at,
               (due_on - app.today_riyadh()) AS days_left"""


@router.get("/requests")
def requests(t: Tenant = Depends(get_tenant)):
    return [dict(r) for r in t.conn.execute(text(f"""SELECT {_REQ_COLS} FROM pdpl_requests
        ORDER BY (status IN ('COMPLETED','REJECTED')), due_on""")).mappings()]


@router.post("/requests", status_code=201)
def add_request(body: RequestIn, t: Tenant = Depends(get_tenant)):
    _write(t)
    due = body.due_on or body.received_on + timedelta(days=REQUEST_DAYS)
    if due < body.received_on:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "موعد الرد قبل تاريخ الاستلام")
    rid = t.conn.execute(text("""
        INSERT INTO pdpl_requests (org_id, requester_name, requester_contact, request_type, channel, details,
                                   received_on, due_on, created_by)
        VALUES (:o, :requester_name, :requester_contact, :request_type, :channel, :details, :received_on, :due, :u)
        RETURNING id"""), {**body.model_dump(), "o": t.org_id, "due": due, "u": t.principal.user_id}).scalar_one()
    _audit(t.conn, t, "PDPL_REQUEST_ADD", "pdpl_request", rid, {"type": body.request_type})
    return {"id": rid, "due_on": due}


@router.patch("/requests/{request_id}")
def update_request(request_id: UUID, body: RequestUpdate, t: Tenant = Depends(get_tenant)):
    _write(t)
    done = body.status in ("COMPLETED", "REJECTED")
    if body.status == "COMPLETED" and not body.identity_verified:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "تحقق من هوية مقدم الطلب قبل إغلاقه بالتنفيذ")
    n = t.conn.execute(text("""
        UPDATE pdpl_requests SET status = :s, identity_verified = :v, response_note = :note,
            due_on = COALESCE(:due, due_on), completed_on = CASE WHEN :done THEN COALESCE(completed_on, app.today_riyadh()) END,
            updated_at = now()
        WHERE id = :id"""), {"s": body.status, "v": body.identity_verified, "note": body.response_note,
                             "due": body.due_on, "done": done, "id": request_id}).rowcount
    if not n:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الطلب غير موجود")
    _audit(t.conn, t, "PDPL_REQUEST_STATUS", "pdpl_request", request_id, body.model_dump())
    return {"updated": True}


# ------------------------------------------------------------------ حوادث التسرب
class IncidentIn(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    description: str | None = None
    discovered_at: datetime
    occurred_at: datetime | None = None
    data_categories: list[str] = Field(default_factory=list, max_length=40)
    subjects_affected: int | None = Field(default=None, ge=0)
    severity: Literal["LOW", "MEDIUM", "HIGH"] = "MEDIUM"
    harm_likely: bool = True


class IncidentUpdate(BaseModel):
    status: Literal["OPEN", "CONTAINED", "REPORTED", "CLOSED"]
    harm_likely: bool | None = None
    authority_notified_at: datetime | None = None
    subjects_notified_at: datetime | None = None
    root_cause: str | None = None
    actions_taken: str | None = None


_INC_COLS = f"""id, title, description, discovered_at, occurred_at, data_categories, subjects_affected, severity, harm_likely,
               status, authority_notified_at, subjects_notified_at, root_cause, actions_taken, created_at,
               discovered_at + interval '{NOTIFY_HOURS} hours' AS notify_deadline"""


@router.get("/incidents")
def incidents(t: Tenant = Depends(get_tenant)):
    return [dict(r) for r in t.conn.execute(text(f"""SELECT {_INC_COLS} FROM pdpl_incidents
        ORDER BY (status = 'CLOSED'), discovered_at DESC""")).mappings()]


@router.post("/incidents", status_code=201)
def add_incident(body: IncidentIn, t: Tenant = Depends(get_tenant)):
    _write(t)
    if body.occurred_at and body.occurred_at > body.discovered_at:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "تاريخ الوقوع بعد تاريخ الاكتشاف")
    iid = t.conn.execute(text("""
        INSERT INTO pdpl_incidents (org_id, title, description, discovered_at, occurred_at, data_categories,
                                    subjects_affected, severity, harm_likely, created_by)
        VALUES (:o, :title, :description, :discovered_at, :occurred_at, CAST(:cats AS jsonb),
                :subjects_affected, :severity, :harm_likely, :u) RETURNING id"""),
        {**body.model_dump(), "cats": json.dumps(body.data_categories, ensure_ascii=False), "o": t.org_id,
         "u": t.principal.user_id}).scalar_one()
    _audit(t.conn, t, "PDPL_INCIDENT_ADD", "pdpl_incident", iid, {"title": body.title, "severity": body.severity})
    return {"id": iid}


@router.patch("/incidents/{incident_id}")
def update_incident(incident_id: UUID, body: IncidentUpdate, t: Tenant = Depends(get_tenant)):
    _write(t)
    cur = t.conn.execute(text("SELECT authority_notified_at FROM pdpl_incidents WHERE id = :id"), {"id": incident_id}).one_or_none()
    if cur is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الحادثة غير موجودة")
    notified = body.authority_notified_at or cur.authority_notified_at
    if body.status == "REPORTED" and not notified:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "سجّل وقت إبلاغ الجهة المختصة")
    t.conn.execute(text("""
        UPDATE pdpl_incidents SET status = :status, harm_likely = COALESCE(:harm_likely, harm_likely),
            authority_notified_at = COALESCE(:authority_notified_at, authority_notified_at),
            subjects_notified_at = COALESCE(:subjects_notified_at, subjects_notified_at),
            root_cause = COALESCE(:root_cause, root_cause), actions_taken = COALESCE(:actions_taken, actions_taken),
            updated_at = now()
        WHERE id = :id"""), {**body.model_dump(), "id": incident_id})
    _audit(t.conn, t, "PDPL_INCIDENT_UPDATE", "pdpl_incident", incident_id, body.model_dump())
    return {"updated": True}


# ------------------------------------------------------------------ ملخص
@router.get("/summary")
def summary(t: Tenant = Depends(get_tenant)):
    c = t.conn
    rec = c.execute(text("""SELECT count(*) AS n,
        count(*) FILTER (WHERE owner_membership_id IS NULL) AS no_owner,
        count(*) FILTER (WHERE cross_border_transfer) AS cross_border,
        count(*) FILTER (WHERE includes_sensitive_data) AS sensitive,
        count(*) FILTER (WHERE next_review_date < app.today_riyadh()) AS review_overdue
        FROM pdpl_data_records""")).mappings().one()
    req = c.execute(text("""SELECT count(*) FILTER (WHERE status IN ('OPEN','IN_PROGRESS')) AS open,
        count(*) FILTER (WHERE status IN ('OPEN','IN_PROGRESS') AND due_on < app.today_riyadh()) AS overdue
        FROM pdpl_requests""")).mappings().one()
    inc = c.execute(text(f"""SELECT count(*) FILTER (WHERE status <> 'CLOSED') AS open,
        count(*) FILTER (WHERE harm_likely AND authority_notified_at IS NULL AND status <> 'CLOSED'
                         AND now() > discovered_at + interval '{NOTIFY_HOURS} hours') AS notify_overdue
        FROM pdpl_incidents""")).mappings().one()
    return {"records": dict(rec), "requests": dict(req), "incidents": dict(inc),
            "notify_hours": NOTIFY_HOURS, "request_days": REQUEST_DAYS}
