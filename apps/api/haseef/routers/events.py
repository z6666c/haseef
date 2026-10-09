"""تقويم المناسبات السنوية: يعرضه كل عميل ويختار إرسال التهاني لموظفيه، وتديره غرفة العمليات."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from ..deps import Admin, Tenant, get_tenant, require_perm
from ..services.hr_service import row, today
from .compliance import _audit

router = APIRouter(tags=["events"])
EVENT_COLS = "id, code, name, event_date, kind, is_holiday, holiday_days, greeting, notify_subscribers, is_active"


@router.get("/events")
def org_events(t: Tenant = Depends(get_tenant)):
    c = t.conn
    d = today()
    events = [row(r) for r in c.execute(text(f"""SELECT {EVENT_COLS} FROM annual_events WHERE is_active AND event_date >= :d AND event_date < :e
                                                ORDER BY event_date"""), {"d": d - timedelta(days=1), "e": d + timedelta(days=400)}).mappings()]
    s = c.execute(text("SELECT enabled, signature, excluded_codes FROM org_event_settings WHERE org_id = :o"), {"o": t.org_id}).mappings().one_or_none()
    org = c.execute(text("SELECT name FROM organizations WHERE id = :o"), {"o": t.org_id}).scalar_one()
    reach = c.execute(text("""SELECT count(*) FROM org_employees e WHERE e.is_active AND (e.mobile IS NOT NULL OR EXISTS
                              (SELECT 1 FROM bot_members b WHERE b.employee_id = e.id AND b.status = 'ACTIVE'))""")).scalar_one()
    sent = c.execute(text("SELECT count(*) FROM event_sends WHERE audience = 'EMPLOYEE' AND status = 'SENT'")).scalar_one()
    return {"events": events, "can_manage": t.role in ("ORG_ADMIN", "COMPLIANCE_OFFICER"),
            "settings": dict(s) if s else {"enabled": False, "signature": None, "excluded_codes": []},
            "org_name": org, "reachable_employees": reach, "sent_total": sent}


class OrgEventsIn(BaseModel):
    enabled: bool
    signature: str | None = Field(None, max_length=120)
    excluded_codes: list[str] = Field(default_factory=list, max_length=30)


@router.put("/events/settings")
def put_org_events(body: OrgEventsIn, t: Tenant = Depends(get_tenant)):
    t.require("ORG_ADMIN", "COMPLIANCE_OFFICER")
    t.conn.execute(text("""INSERT INTO org_event_settings (org_id, enabled, signature, excluded_codes) VALUES (:o, :e, :s, :x)
                           ON CONFLICT (org_id) DO UPDATE SET enabled = :e, signature = :s, excluded_codes = :x, updated_at = now()"""),
                   {"o": t.org_id, "e": body.enabled, "s": (body.signature or "").strip() or None, "x": [c[:30] for c in body.excluded_codes]})
    _audit(t.conn, t, "UPDATE", "org_event_settings", None, body.model_dump())
    return {"ok": True}


# ---------------------------------------------------------------- غرفة العمليات
@router.get("/admin/events")
def admin_events(a: Admin = Depends(require_perm("content.manage"))):
    ev = [row(r) for r in a.conn.execute(text(f"""
        SELECT {EVENT_COLS}, (SELECT count(*) FROM event_sends s WHERE s.event_id = e.id AND s.audience = 'SUBSCRIBER' AND s.status = 'SENT') AS sent_subscribers,
               (SELECT count(*) FROM event_sends s WHERE s.event_id = e.id AND s.audience = 'EMPLOYEE' AND s.status = 'SENT') AS sent_employees
        FROM annual_events e WHERE event_date >= :d ORDER BY event_date"""), {"d": today() - timedelta(days=60)}).mappings()]
    orgs = a.conn.execute(text("SELECT count(*) FROM org_event_settings WHERE enabled")).scalar_one()
    return {"events": ev, "orgs_enabled": orgs}


class EventIn(BaseModel):
    code: str = Field(min_length=2, max_length=30, pattern=r"^[A-Z0-9_]+$")
    name: str = Field(min_length=2, max_length=120)
    event_date: date
    kind: Literal["NATIONAL", "RELIGIOUS", "OCCASION"]
    is_holiday: bool = False
    holiday_days: int = Field(0, ge=0, le=14)
    greeting: str = Field(min_length=5, max_length=500)
    notify_subscribers: bool = True
    is_active: bool = True


@router.post("/admin/events", status_code=201)
def add_event(body: EventIn, a: Admin = Depends(require_perm("content.manage"))):
    eid = a.conn.execute(text("""INSERT INTO annual_events (code, name, event_date, kind, is_holiday, holiday_days, greeting, notify_subscribers, is_active)
                                 VALUES (:code, :name, :event_date, :kind, :is_holiday, :holiday_days, :greeting, :notify_subscribers, :is_active)
                                 ON CONFLICT (code, event_date) DO NOTHING RETURNING id"""), body.model_dump()).scalar_one_or_none()
    if eid is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "المناسبة مضافة بهذا التاريخ")
    a.audit("ADMIN_EVENT_CREATE", "annual_event", eid, None, body.model_dump(mode="json"))
    return {"id": eid}


@router.put("/admin/events/{event_id}")
def edit_event(event_id: UUID, body: EventIn, a: Admin = Depends(require_perm("content.manage"))):
    if not a.conn.execute(text("""UPDATE annual_events SET code = :code, name = :name, event_date = :event_date, kind = :kind, is_holiday = :is_holiday,
                                  holiday_days = :holiday_days, greeting = :greeting, notify_subscribers = :notify_subscribers, is_active = :is_active
                                  WHERE id = :id"""), {**body.model_dump(), "id": event_id}).rowcount:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "المناسبة غير موجودة")
    a.audit("ADMIN_EVENT_UPDATE", "annual_event", event_id, None, body.model_dump(mode="json"))
    return {"ok": True}
