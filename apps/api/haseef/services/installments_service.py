"""الاشتراك السنوي بالأقساط: إنشاء الخطة، تسجيل دفع القسط بفاتورته، وتذكير المنشأة قبل الاستحقاق وبعده.

التذكير يُرسل لمدير المنشأة الفعّال (جهة الفوترة) على البريد والواتساب، بالقالب haseef_payment_due:
  {{1}} الاسم، {{2}} المنشأة، {{3}} وصف القسط، {{4}} المبلغ شامل الضريبة، {{5}} العبارة الزمنية، {{6}} التاريخ، {{7}} الرابط.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from decimal import Decimal
from typing import Callable, ContextManager
from uuid import UUID

from sqlalchemy import Connection, text

from ..domain.arabic import due_phrase, format_date
from ..domain.finance import add_months, r2, reminder_stage, schedule
from ..domain.alerts import RIYADH
from ..messaging.base import MessageSender, SendError
from . import invoicing

log = logging.getLogger(__name__)
TEMPLATE = "haseef_payment_due"
PLAN_NAME = invoicing.PLAN_NAME


def today_riyadh() -> date:
    from datetime import datetime
    return datetime.now(RIYADH).date()


def create_plan(conn: Connection, *, org_id: UUID, tier: str, installments: int, starts_on: date,
                total_net: Decimal | None, note: str | None, user_id) -> UUID:
    if conn.execute(text("SELECT 1 FROM payment_plans WHERE org_id = :o AND status = 'ACTIVE'"), {"o": org_id}).first():
        raise ValueError("لدى المنشأة خطة دفع فعّالة؛ ألغها أو أكملها أولاً")
    price = conn.execute(text("SELECT yearly_price_sar FROM plans WHERE tier = :t"), {"t": tier}).scalar_one()
    total = r2(total_net if total_net is not None else price)
    rows = schedule(total, installments, starts_on)
    ends_on = add_months(starts_on, 12)
    # الاشتراك سنوي فعّال طوال مدة العقد، بغض النظر عن تقسيط الدفع
    sub = conn.execute(text("""SELECT id FROM subscriptions WHERE org_id = :o AND billing_status IN ('TRIAL','ACTIVE','PAST_DUE')
                               ORDER BY starts_at DESC LIMIT 1"""), {"o": org_id}).scalar_one_or_none()
    if sub:
        conn.execute(text("""UPDATE subscriptions SET plan_tier = :t, billing_cycle = 'YEARLY', billing_status = 'ACTIVE',
                                    starts_at = :s, ends_at = :e WHERE id = :id"""), {"t": tier, "s": starts_on, "e": ends_on, "id": sub})
    else:
        sub = conn.execute(text("""INSERT INTO subscriptions (org_id, plan_tier, billing_cycle, starts_at, ends_at, billing_status)
                                   VALUES (:o, :t, 'YEARLY', :s, :e, 'ACTIVE') RETURNING id"""),
                           {"o": org_id, "t": tier, "s": starts_on, "e": ends_on}).scalar_one()
    pid = conn.execute(text("""
        INSERT INTO payment_plans (org_id, subscription_id, plan_tier, total_net, installments, starts_on, ends_on, note, created_by)
        VALUES (:o, :s, :t, :total, :n, :start, :end, :note, :u) RETURNING id"""),
        {"o": org_id, "s": sub, "t": tier, "total": total, "n": installments, "start": starts_on, "end": ends_on,
         "note": note, "u": user_id}).scalar_one()
    for r in rows:
        conn.execute(text("INSERT INTO plan_installments (plan_id, seq, due_date, amount_net) VALUES (:p, :s, :d, :a)"),
                     {"p": pid, "s": r["seq"], "d": r["due_date"], "a": r["amount_net"]})
    return pid


def pay(conn: Connection, *, plan_id: UUID, installment_id: UUID, reference: str | None, user_id) -> dict:
    row = conn.execute(text("""
        SELECT i.id, i.seq, i.amount_net, i.paid_at, p.org_id, p.subscription_id, p.plan_tier, p.installments, p.status
        FROM plan_installments i JOIN payment_plans p ON p.id = i.plan_id
        WHERE i.id = :i AND p.id = :p FOR UPDATE OF i"""), {"i": installment_id, "p": plan_id}).mappings().one_or_none()
    if row is None:
        raise LookupError("القسط غير موجود")
    if row["paid_at"]:
        raise ValueError("القسط مدفوع أصلاً")
    if row["status"] != "ACTIVE":
        raise ValueError("خطة الدفع غير فعّالة")
    months = 12 // row["installments"]
    ev = conn.execute(text("""
        INSERT INTO billing_events (org_id, subscription_id, event_type, plan_tier, amount_sar, period_months, reference, note, actor_user_id)
        VALUES (:o, :s, 'PAYMENT', :t, :a, :m, :r, :note, :u) RETURNING id"""),
        {"o": row["org_id"], "s": row["subscription_id"], "t": row["plan_tier"], "a": row["amount_net"], "m": months,
         "r": reference, "note": f"القسط {row['seq']} من {row['installments']}", "u": user_id}).scalar_one()
    desc = f"اشتراك سنوي {PLAN_NAME.get(row['plan_tier'], row['plan_tier'])} — القسط {row['seq']} من {row['installments']}"
    inv = invoicing.invoice_subscription_payment(conn, billing_event_id=ev, user_id=user_id, description=desc)
    conn.execute(text("UPDATE plan_installments SET paid_at = now(), invoice_id = :inv, payment_reference = :r WHERE id = :i"),
                 {"inv": inv["id"], "r": reference, "i": installment_id})
    left = conn.execute(text("SELECT count(*) FROM plan_installments WHERE plan_id = :p AND paid_at IS NULL"), {"p": plan_id}).scalar_one()
    if left == 0:
        conn.execute(text("UPDATE payment_plans SET status = 'COMPLETED' WHERE id = :p"), {"p": plan_id})
    return inv


PLAN_COLS = """
    p.id, p.org_id, o.name AS org_name, p.plan_tier, p.total_net, p.installments, p.starts_on, p.ends_on, p.status, p.note,
    p.created_at,
    COALESCE(sum(i.amount_net) FILTER (WHERE i.paid_at IS NOT NULL), 0) AS paid_net,
    COALESCE(sum(i.amount_net) FILTER (WHERE i.paid_at IS NULL), 0)     AS remaining_net,
    count(*) FILTER (WHERE i.paid_at IS NOT NULL)                       AS paid_count,
    min(i.due_date) FILTER (WHERE i.paid_at IS NULL)                    AS next_due,
    count(*) FILTER (WHERE i.paid_at IS NULL AND i.due_date < :today)   AS overdue_count
"""


def plans(conn: Connection, *, status: str | None = None, org_id: UUID | None = None) -> list[dict]:
    rows = conn.execute(text(f"""
        SELECT {PLAN_COLS}
        FROM payment_plans p JOIN organizations o ON o.id = p.org_id JOIN plan_installments i ON i.plan_id = p.id
        WHERE (CAST(:st AS text) IS NULL OR p.status = :st) AND (CAST(:o AS uuid) IS NULL OR p.org_id = :o)
        GROUP BY p.id, o.name ORDER BY (p.status = 'ACTIVE') DESC, min(i.due_date) FILTER (WHERE i.paid_at IS NULL) NULLS LAST, p.created_at DESC"""),
        {"st": status, "o": org_id, "today": today_riyadh()}).mappings()
    return [dict(r) for r in rows]


def plan_detail(conn: Connection, plan_id: UUID) -> dict | None:
    head = conn.execute(text(f"""
        SELECT {PLAN_COLS}
        FROM payment_plans p JOIN organizations o ON o.id = p.org_id JOIN plan_installments i ON i.plan_id = p.id
        WHERE p.id = :p GROUP BY p.id, o.name"""), {"p": plan_id, "today": today_riyadh()}).mappings().one_or_none()
    if head is None:
        return None
    inst = conn.execute(text("""
        SELECT i.id, i.seq, i.due_date, i.amount_net, i.paid_at, i.payment_reference, i.invoice_id, v.number AS invoice_number,
               (SELECT max(sent_at) FROM installment_reminders r WHERE r.installment_id = i.id AND r.status = 'SENT') AS last_reminder_at,
               (SELECT count(*) FROM installment_reminders r WHERE r.installment_id = i.id AND r.status = 'SENT') AS reminders
        FROM plan_installments i LEFT JOIN invoices v ON v.id = i.invoice_id
        WHERE i.plan_id = :p ORDER BY i.seq"""), {"p": plan_id}).mappings()
    return {**dict(head), "items": [dict(r) for r in inst]}


# ---------------------------------------------------------------- التذكير
def _recipients(conn: Connection, org_id: UUID) -> list[dict]:
    return [dict(r) for r in conn.execute(text("""
        SELECT u.full_name, u.email::text AS email, u.phone_number FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.org_id = :o AND m.role = 'ORG_ADMIN' AND m.is_active AND u.is_active"""), {"o": org_id}).mappings()]


def _message(inst: dict, rec: dict, today: date, vat_registered: bool, link: str) -> list[str]:
    gross = r2(Decimal(inst["amount_net"]) * (Decimal("1.15") if vat_registered else 1))
    days = (inst["due_date"] - today).days
    return [rec["full_name"].split()[0], inst["org_name"], f"القسط {inst['seq']} من {inst['installments']} لاشتراك حصيف السنوي",
            f"{gross:,.2f} ريال", due_phrase(days), format_date(inst["due_date"]), link]


def _send(conn_tx, senders: dict[str, MessageSender], inst: dict, stage: str, today: date, link: str, user_id=None) -> int:
    with conn_tx() as conn:
        recs = _recipients(conn, inst["org_id"])
        vat_reg = conn.execute(text("SELECT vat_registered FROM haseef_profile WHERE id = 1")).scalar_one()
    sent = 0
    for rec in recs:
        for channel, to in (("EMAIL", rec["email"]), ("WHATSAPP", rec["phone_number"])):
            if not to or channel not in senders:
                continue
            if stage != "MANUAL":
                with conn_tx() as conn:
                    if conn.execute(text("""SELECT 1 FROM installment_reminders WHERE installment_id = :i AND stage = :s
                                            AND channel = :c AND recipient = :r AND status = 'SENT'"""),
                                    {"i": inst["id"], "s": stage, "c": channel, "r": to}).first():
                        continue
            try:
                _, msg_id = senders[channel].send(to, TEMPLATE, _message(inst, rec, today, vat_reg, link))
                status, err = "SENT", None
                sent += 1
            except SendError as e:
                status, msg_id, err = "FAILED", None, str(e)[:1000]
                log.warning("installment reminder %s failed: %s", inst["id"], e)
            with conn_tx() as conn:
                conn.execute(text("""INSERT INTO installment_reminders (installment_id, stage, channel, recipient, status,
                                                                        provider_message_id, error, sent_by)
                                     VALUES (:i, :s, :c, :r, :st, :m, :e, :u) ON CONFLICT DO NOTHING"""),
                             {"i": inst["id"], "s": stage, "c": channel, "r": to, "st": status, "m": msg_id, "e": err, "u": user_id})
    return sent


_DUE = """
    SELECT i.id, i.seq, i.due_date, i.amount_net, p.org_id, p.installments, o.name AS org_name
    FROM plan_installments i JOIN payment_plans p ON p.id = i.plan_id JOIN organizations o ON o.id = p.org_id
    WHERE i.paid_at IS NULL AND p.status = 'ACTIVE' AND o.is_active AND o.suspended_at IS NULL
"""


def send_due_reminders(conn_tx: Callable[[], ContextManager[Connection]], senders: dict[str, MessageSender],
                       link: str, today: date | None = None) -> int:
    """مهمة يومية: تذكير قبل 7 أيام، ويوم الاستحقاق، وبعد 3 أيام تأخير — مرة واحدة لكل مرحلة."""
    today = today or today_riyadh()
    with conn_tx() as conn:
        rows = [dict(r) for r in conn.execute(text(f"{_DUE} AND i.due_date BETWEEN :a AND :b"),
                                               {"a": today - timedelta(days=3), "b": today + timedelta(days=7)}).mappings()]
    sent = 0
    for inst in rows:
        stage = reminder_stage((inst["due_date"] - today).days)
        if stage:
            sent += _send(conn_tx, senders, inst, stage, today, link)
    return sent


def remind_now(conn_tx, senders: dict[str, MessageSender], installment_id: UUID, link: str, user_id) -> int:
    with conn_tx() as conn:
        inst = conn.execute(text(f"{_DUE} AND i.id = :i"), {"i": installment_id}).mappings().one_or_none()
    if inst is None:
        raise LookupError("القسط غير موجود أو مدفوع")
    return _send(conn_tx, senders, dict(inst), "MANUAL", today_riyadh(), link, user_id)
