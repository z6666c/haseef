"""تذكير قبل انتهاء الشهر المجاني (عرض الإطلاق) بخمسة أيام: بريد وواتساب لمدير المنشأة، مرة واحدة.

لا يُرسل إن جدّدت المنشأة الإضافة بالدفع (نهاية الإضافة تجاوزت نهاية العرض).
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Callable, ContextManager

from sqlalchemy import Connection, text

from ..messaging.base import MessageSender, SendError
from .governance_service import riyadh_today

log = logging.getLogger(__name__)
TEMPLATE = "haseef_promo_ending"
REMIND_DAYS = 5


def due(conn: Connection) -> list[dict]:
    return [dict(r) for r in conn.execute(text("""
        SELECT r.id, r.org_id, r.addon_code, r.paid_until, o.name AS org_name, c.name AS addon_name, c.monthly_price
        FROM promotion_redemptions r
        JOIN organizations o ON o.id = r.org_id AND o.is_active
        JOIN addon_catalog c ON c.code = r.addon_code
        JOIN org_addons a ON a.org_id = r.org_id AND a.code = r.addon_code AND a.status = 'ACTIVE'
        WHERE r.reminded_at IS NULL AND r.paid_until > now() AND r.paid_until <= now() + make_interval(days => :d)
          AND a.paid_until <= r.paid_until"""), {"d": REMIND_DAYS}).mappings()]


def send_reminders(conn_tx: Callable[[], ContextManager[Connection]], senders: dict[str, MessageSender], link: str) -> int:
    from .installments_service import _recipients
    from ..domain.arabic import format_date
    with conn_tx() as conn:
        rows = due(conn)
    sent = 0
    today = riyadh_today()
    for r in rows:
        end = (r["paid_until"] + timedelta(hours=3)).date()
        days = (end - today).days
        when = "اليوم" if days <= 0 else "غداً" if days == 1 else f"بعد {days} أيام"
        with conn_tx() as conn:
            recs = _recipients(conn, r["org_id"])
        for rec in recs:
            for channel, to in (("EMAIL", rec["email"]), ("WHATSAPP", rec["phone_number"])):
                if not to or channel not in senders:
                    continue
                try:
                    senders[channel].send(to, TEMPLATE, [rec["full_name"].split()[0], r["org_name"], r["addon_name"], when,
                                                         format_date(end), f"{float(r['monthly_price']):,.0f} ريال", link])
                    sent += 1
                except SendError as e:
                    log.warning("promo reminder %s failed: %s", r["id"], e)
        with conn_tx() as conn:
            conn.execute(text("UPDATE promotion_redemptions SET reminded_at = now() WHERE id = :i"), {"i": r["id"]})
    return sent
