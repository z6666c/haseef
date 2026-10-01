"""ربط محرك التنبيهات بقاعدة البيانات: تخطيط ليلي + إرسال نهاري.

يعمل بصلاحيات المنصة (عابر لكل المنشآت)، والمنطق نفسه في domain/alerts.py.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from contextlib import AbstractContextManager as ContextManager
from datetime import date, datetime, time, timezone

from sqlalchemy import Connection, text

from ..domain.alerts import (
    RIYADH, AlertTarget, DispatchKey, OrgAlertContext, Recipient, plan_dispatches,
)
from ..messaging.base import MessageSender, SendError

log = logging.getLogger(__name__)


def _load(conn: Connection) -> tuple[list[AlertTarget], dict, dict, set[DispatchKey]]:
    ctx_rows = conn.execute(text("SELECT * FROM v_org_alert_context")).mappings().all()
    org_ctx = {
        str(r["org_id"]): OrgAlertContext(r["subscription_active"], r["whatsapp_quota_remaining"])
        for r in ctx_rows
    }
    org_names = {str(r["org_id"]): r["org_name"] for r in ctx_rows}

    targets = [
        AlertTarget(
            org_id=str(r["org_id"]), org_name=org_names.get(str(r["org_id"]), ""),
            target_type=r["target_type"], target_id=str(r["target_id"]), title=r["title"],
            due_date=r["due_date"], thresholds=tuple(r["thresholds"]), channels=tuple(r["channels"]),
            enabled=r["enabled"], link=r["link"],
        )
        for r in conn.execute(text("SELECT * FROM v_alert_targets")).mappings()
        if str(r["org_id"]) in org_ctx
    ]

    recipients: dict[str, list[Recipient]] = {}
    for r in conn.execute(text("SELECT * FROM v_alert_recipients")).mappings():
        recipients.setdefault(str(r["org_id"]), []).append(
            Recipient(str(r["user_id"]), r["full_name"], r["email"], r["phone"], tuple(r["channels"]))
        )

    # يكفي تحميل مفاتيح التنبيهات لتواريخ استحقاق لم تمضِ عليها سنة.
    already = {
        DispatchKey(r.target_type, str(r.target_id), r.due_date, r.threshold_days, r.channel, r.recipient_address)
        for r in conn.execute(text("""
            SELECT target_type, target_id, due_date, threshold_days, channel, recipient_address
            FROM alert_dispatches WHERE due_date > current_date - 365
        """))
    }
    return targets, recipients, org_ctx, already


_INSERT = text("""
    INSERT INTO alert_dispatches
        (org_id, target_type, target_id, due_date, threshold_days, channel,
         recipient_user_id, recipient_address, status, skip_reason, scheduled_for, payload)
    VALUES (:org_id, :target_type, :target_id, :due_date, :threshold_days, :channel,
            :recipient_user_id, :recipient_address, :status, :skip_reason, :scheduled_for, CAST(:payload AS jsonb))
    ON CONFLICT (target_type, target_id, due_date, threshold_days, channel, recipient_address) DO NOTHING
""")


def plan_alerts(conn: Connection, *, today: date | None = None, now: datetime | None = None,
                send_hour: int = 9) -> int:
    now = now or datetime.now(timezone.utc)
    today = today or now.astimezone(RIYADH).date()
    targets, recipients, org_ctx, already = _load(conn)
    planned = plan_dispatches(
        today=today, now=now, targets=targets, recipients_by_org=recipients,
        org_context=org_ctx, already_dispatched=already, send_at=time(send_hour, 0),
    )
    for d in planned:
        conn.execute(_INSERT, {
            "org_id": d.org_id, "target_type": d.key.target_type, "target_id": d.key.target_id,
            "due_date": d.key.due_date, "threshold_days": d.key.threshold_days, "channel": d.key.channel,
            "recipient_user_id": d.recipient_user_id, "recipient_address": d.key.recipient_address,
            "status": d.status, "skip_reason": d.skip_reason, "scheduled_for": d.scheduled_for,
            "payload": json.dumps({"template": d.template, "variables": d.variables}, ensure_ascii=False),
        })
    log.info("planned %d alert dispatches", len(planned))
    return len(planned)


MAX_ATTEMPTS = 5

_CLAIM = text("""
    UPDATE alert_dispatches SET status = 'SENDING', attempts = attempts + 1, claimed_at = now()
    WHERE id IN (
        SELECT id FROM alert_dispatches
        WHERE status = 'QUEUED' AND scheduled_for <= now()
        ORDER BY scheduled_for
        LIMIT :batch
        FOR UPDATE SKIP LOCKED          -- عدة عمّال لا يلتقطون نفس الرسالة
    )
    RETURNING id, channel, recipient_address, payload, attempts
""")


def send_due_alerts(tx: Callable[[], ContextManager[Connection]],
                    senders: dict[str, MessageSender], batch: int = 200) -> int:
    """يرسل ما حان موعده.

    كل خطوة في معاملة قصيرة مستقلة: الحجز يُثبَّت (SENDING) قبل الاتصال بالمزوّد،
    ونتيجة كل رسالة تُثبَّت فور معرفتها. لو تعطّل العامل في المنتصف لا تُعاد الرسائل
    التي أُرسلت فعلاً؛ والعالقة في SENDING تُعاد للطابور بعد 15 دقيقة.
    """
    with tx() as conn:
        conn.execute(text("""
            UPDATE alert_dispatches SET status = 'QUEUED', last_error = 'recovered from stuck SENDING'
            WHERE status = 'SENDING' AND claimed_at < now() - interval '15 minutes'"""))
        claimed = conn.execute(_CLAIM, {"batch": batch}).mappings().all()

    sent = 0
    for row in claimed:
        sender = senders.get(row["channel"])
        payload = row["payload"] or {}
        try:
            if sender is None:
                raise SendError(f"no sender configured for {row['channel']}", retryable=False)
            provider, msg_id = sender.send(row["recipient_address"], payload["template"], payload["variables"])
        except SendError as e:
            final = (not e.retryable) or row["attempts"] >= MAX_ATTEMPTS
            with tx() as conn:
                # إعادة المحاولة بتأخير متزايد: 5، 10، 20، 40 دقيقة
                conn.execute(text("""
                    UPDATE alert_dispatches
                    SET status = :st, last_error = :err,
                        scheduled_for = CASE WHEN :final THEN scheduled_for
                                             ELSE now() + make_interval(mins => (5 * power(2, attempts - 1))::int) END
                    WHERE id = :id"""), {"id": row["id"], "st": "FAILED" if final else "QUEUED",
                                         "err": str(e)[:1000], "final": final})
            log.warning("dispatch %s failed (final=%s): %s", row["id"], final, e)
            continue
        with tx() as conn:
            conn.execute(text("""
                UPDATE alert_dispatches
                SET status='SENT', sent_at=now(), provider=:p, provider_message_id=:m, last_error=NULL
                WHERE id=:id"""), {"id": row["id"], "p": provider, "m": msg_id})
        sent += 1
    return sent
