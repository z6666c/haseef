"""شاشة التنبيهات: القواعد، المستلمون، حصة الواتساب الشهرية، التنبيهات القادمة، وسجل الإرسال.

القواعد نفسها تُحدَّث عبر PUT /alert-rules (dashboard.py). هنا العرض المجمّع وإعداد المستلمين.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from ..config import get_settings
from ..deps import Tenant, get_tenant
from ..services import governance_service as gs
from ..services.entitlements import org_plan
from .compliance import _audit

router = APIRouter(prefix="/alerts", tags=["alerts"])

DEFAULTS = {"COMPLIANCE_ITEM": {"days_before": [60, 30, 14, 7, 3, 1, 0], "channels": ["WHATSAPP", "EMAIL"]},
            "POLICY": {"days_before": [30, 14, 7, 0], "channels": ["EMAIL", "WHATSAPP"]}}
HORIZON_DAYS = 60


def next_alert(due: date, thresholds: list[int], today: date) -> tuple[date, int] | None:
    """أقرب موعد تنبيه قادم (اليوم أو بعده) لعنصر تاريخ استحقاقه due."""
    days_left = (due - today).days
    upcoming = sorted((t for t in thresholds if t <= days_left), reverse=True)
    if upcoming:
        t = upcoming[0]
        return due - timedelta(days=t), t
    return None


@router.get("/overview")
def overview(t: Tenant = Depends(get_tenant)):
    c = t.conn
    today = gs.riyadh_today()
    plan = org_plan(c, t.org_id)
    used = c.execute(text("""SELECT count(*) FROM alert_dispatches WHERE channel = 'WHATSAPP'
        AND status NOT IN ('SKIPPED','CANCELED','FAILED')
        AND created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh'""")).scalar_one()
    limit = plan["monthly_whatsapp_alerts"]
    rules = {r["target_type"]: dict(r) for r in c.execute(text("""SELECT target_type, days_before, channels, is_enabled
        FROM alert_rules WHERE target_id IS NULL""")).mappings()}
    rules_out = {k: {**v, "is_enabled": True, "is_default": True, **({**rules[k], "is_default": False} if k in rules else {})}
                 for k, v in DEFAULTS.items()}
    custom = c.execute(text("SELECT count(*) FROM alert_rules WHERE target_id IS NOT NULL")).scalar_one()

    recipients = [dict(r) for r in c.execute(text("""
        SELECT m.id AS membership_id, u.full_name, u.email::text AS email, u.phone_number AS phone, m.role,
               m.receives_alerts, m.alert_channels, (m.user_id = :u) AS is_me
        FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.is_active ORDER BY u.full_name"""),
        {"u": t.principal.user_id}).mappings()]

    upcoming = []
    for r in c.execute(text("""SELECT target_type, target_id, title, due_date, thresholds, channels, enabled
                               FROM v_alert_targets WHERE due_date <= :h"""), {"h": today + timedelta(days=HORIZON_DAYS + 60)}).mappings():
        if not r["enabled"]:
            continue
        nxt = next_alert(r["due_date"], list(r["thresholds"]), today)
        if nxt and nxt[0] <= today + timedelta(days=HORIZON_DAYS):
            upcoming.append({"target_type": r["target_type"], "target_id": r["target_id"], "title": r["title"],
                             "due_date": r["due_date"], "alert_on": nxt[0], "threshold_days": nxt[1],
                             "channels": list(r["channels"])})
    upcoming.sort(key=lambda x: x["alert_on"])

    log = [dict(r) for r in c.execute(text("""
        SELECT d.id, d.target_type, COALESCE(ci.title, p.title) AS title, d.due_date, d.threshold_days, d.channel,
               d.status, d.skip_reason, d.scheduled_for, d.sent_at, d.delivered_at, u.full_name AS recipient_name
        FROM alert_dispatches d
        LEFT JOIN compliance_items ci ON d.target_type = 'COMPLIANCE_ITEM' AND ci.id = d.target_id
        LEFT JOIN internal_policies p ON d.target_type = 'POLICY' AND p.id = d.target_id
        LEFT JOIN users u ON u.id = d.recipient_user_id
        ORDER BY d.created_at DESC LIMIT 100""")).mappings()]

    settings = get_settings()
    provider = settings.whatsapp_provider
    return {
        "plan": {"tier": plan["plan_tier"], "name": plan["plan_name"], "active": plan["plan_tier"] is not None},
        "whatsapp": {"provider": provider, "live": provider in ("unifonic", "meta"),
                     "limit": limit, "used": used, "remaining": None if limit is None else max(limit - used, 0)},
        "send_hour": settings.alert_send_hour,
        "rules": rules_out, "custom_rules": custom,
        "recipients": recipients,
        "upcoming": upcoming[:50],
        "log": log,
        "can_manage": t.role in ("ORG_ADMIN", "COMPLIANCE_OFFICER"),
    }


class RecipientIn(BaseModel):
    receives_alerts: bool
    alert_channels: list[Literal["WHATSAPP", "EMAIL"]] = Field(default_factory=list, max_length=2)


@router.patch("/recipients/{membership_id}")
def set_recipient(membership_id: UUID, body: RecipientIn, t: Tenant = Depends(get_tenant)):
    me = t.conn.execute(text("SELECT id FROM memberships WHERE user_id = :u"), {"u": t.principal.user_id}).scalar_one()
    if membership_id != me:
        t.require("ORG_ADMIN")
    if body.receives_alerts and not body.alert_channels:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "اختر قناة واحدة على الأقل")
    n = t.conn.execute(text("""UPDATE memberships SET receives_alerts = :r, alert_channels = :ch WHERE id = :id"""),
                       {"r": body.receives_alerts, "ch": sorted(set(body.alert_channels)), "id": membership_id}).rowcount
    if not n:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "العضو غير موجود")
    _audit(t.conn, t, "ALERT_RECIPIENT", "membership", membership_id, body.model_dump())
    return {"updated": True}
