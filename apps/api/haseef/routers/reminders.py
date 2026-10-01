"""«أرسل تذكير واتساب الآن» من جدول الطوارئ (دليل الهوية §3.2)."""

from __future__ import annotations

import json
import logging
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import text

from ..deps import WRITERS, Tenant, get_tenant
from ..domain.alerts import AlertTarget, Recipient, render_template
from ..domain.arabic import count_members
from .compliance import _audit

router = APIRouter(tags=["reminders"])
log = logging.getLogger(__name__)

RATE_LIMIT_MINUTES = 60


def _kick_sender() -> None:
    """يطلب من العامل الإرسال فوراً بدل انتظار الدورة القادمة (كل 5 دقائق)."""
    try:
        from ..worker import send_due_alerts
        send_due_alerts.apply_async(countdown=3)
    except Exception as e:                       # Redis غير متاح: الدورة الدورية ستلتقطها
        log.warning("could not trigger immediate send: %s", e)


@router.post("/compliance-items/{item_id}/remind", status_code=202)
def remind_now(item_id: UUID, background: BackgroundTasks, t: Tenant = Depends(get_tenant)):
    t.require(*WRITERS)
    c = t.conn

    item = c.execute(text("""
        SELECT ci.id, ci.title, ci.expiry_date, ci.days_remaining, ci.renewal_url, o.name AS org_name
        FROM v_compliance_items ci JOIN organizations o ON o.id = ci.org_id WHERE ci.id = :id"""),
        {"id": item_id}).mappings().one_or_none()
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "العنصر غير موجود")

    recent = c.execute(text("""
        SELECT max(created_at) FROM alert_dispatches
        WHERE kind = 'MANUAL' AND target_id = :id AND created_at > now() - make_interval(mins => :mins)"""),
        {"id": item_id, "mins": RATE_LIMIT_MINUTES}).scalar_one()
    if recent is not None:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "أُرسل تذكير لهذا العنصر قبل أقل من ساعة. يمكنك الإرسال مجدداً بعد مرور ساعة.")

    quota = c.execute(text("SELECT subscription_active, whatsapp_quota_remaining FROM v_org_alert_context")).mappings().one_or_none()
    if not quota or not quota["subscription_active"]:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, "اشتراك المنشأة غير فعّال، فالتنبيهات متوقفة.")

    recipients = [
        Recipient(str(r["user_id"]), r["full_name"], r["email"], r["phone"], tuple(r["channels"]))
        for r in c.execute(text("SELECT * FROM v_alert_recipients WHERE phone IS NOT NULL AND 'WHATSAPP' = ANY(channels)")).mappings()
    ]
    if not recipients:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "لا يوجد عضو في المنشأة لديه رقم واتساب ويستقبل التنبيهات. أضف رقماً من إعدادات الأعضاء.")
    remaining = quota["whatsapp_quota_remaining"]
    if remaining is not None and remaining < len(recipients):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            f"رصيد رسائل الواتساب المتبقي هذا الشهر ({remaining}) لا يكفي لإرسال التذكير.")

    target = AlertTarget(org_id=str(t.org_id), org_name=item["org_name"], target_type="COMPLIANCE_ITEM",
                         target_id=str(item_id), title=item["title"], due_date=item["expiry_date"],
                         link=item["renewal_url"])
    for r in recipients:
        template, variables = render_template(target, r, item["days_remaining"])
        c.execute(text("""
            INSERT INTO alert_dispatches (org_id, target_type, target_id, due_date, threshold_days, channel,
                recipient_user_id, recipient_address, status, scheduled_for, payload, kind, requested_by)
            VALUES (:o, 'COMPLIANCE_ITEM', :id, :due, :days, 'WHATSAPP', :uid, :addr, 'QUEUED', now(),
                    CAST(:payload AS jsonb), 'MANUAL', :by)"""), {
            "o": t.org_id, "id": item_id, "due": item["expiry_date"], "days": item["days_remaining"],
            "uid": r.user_id, "addr": r.phone,
            "payload": json.dumps({"template": template, "variables": variables}, ensure_ascii=False),
            "by": t.principal.user_id,
        })
    _audit(c, t, "REMIND", "compliance_item", item_id, {"recipients": len(recipients)})
    background.add_task(_kick_sender)
    return {"queued": len(recipients),
            "message": f"سيصل التذكير خلال دقائق إلى {count_members(len(recipients))}"}
