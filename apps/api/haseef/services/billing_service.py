"""تطبيق الدفعات على الاشتراكات والإضافات (مشترك بين تسجيل المحاسبة اليدوي والدفع الإلكتروني)."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import Connection, text

from . import invoicing
from ..domain.finance import line


def live_sub(c: Connection, org_id) -> dict | None:
    row = c.execute(text("""
        SELECT s.* FROM subscriptions s WHERE s.org_id = :o AND s.billing_status IN ('TRIAL','ACTIVE','PAST_DUE')"""),
        {"o": org_id}).mappings().one_or_none()
    return dict(row) if row else None


def billing_event(c: Connection, org_id, sub_id, event: str, *, user_id=None, **kw) -> int:
    return c.execute(text("""
        INSERT INTO billing_events (org_id, subscription_id, event_type, plan_tier, amount_sar, period_months, reference, note, actor_user_id)
        VALUES (:o, :s, :e, :tier, :amt, :months, :ref, :note, :u) RETURNING id"""),
        {"o": org_id, "s": sub_id, "e": event, "tier": kw.get("tier"), "amt": kw.get("amount"),
         "months": kw.get("months"), "ref": kw.get("reference"), "note": kw.get("note"), "u": user_id}).scalar_one()


def apply_subscription_payment(c: Connection, *, org_id, tier: str | None, cycle: str, amount_net, reference: str | None,
                               note: str | None, user_id) -> dict:
    """يبدأ اشتراكاً أو يمدده (التجربة تنتهي فوراً عند أول دفعة) ويصدر الفاتورة الضريبية."""
    months = 12 if cycle == "YEARLY" else 1
    sub = live_sub(c, org_id)
    if sub is None:
        if tier is None:
            raise ValueError("اختر الباقة لبدء اشتراك جديد")
        sub_id = c.execute(text("""
            INSERT INTO subscriptions (org_id, plan_tier, billing_cycle, starts_at, ends_at, billing_status)
            VALUES (:o, :t, :c, now(), now() + make_interval(months => :m), 'ACTIVE') RETURNING id"""),
            {"o": org_id, "t": tier, "c": cycle, "m": months}).scalar_one()
    else:
        sub_id, tier = sub["id"], tier or sub["plan_tier"]
        c.execute(text("""
            UPDATE subscriptions SET
                billing_status = 'ACTIVE', billing_cycle = :c, plan_tier = :t,
                starts_at = CASE WHEN billing_status = 'TRIAL' THEN now() ELSE starts_at END,
                ends_at = CASE WHEN billing_status = 'TRIAL' THEN now() ELSE GREATEST(ends_at, now()) END
                          + make_interval(months => :m)
            WHERE id = :s"""), {"c": cycle, "t": tier, "m": months, "s": sub_id})
    ev = billing_event(c, org_id, sub_id, "PAYMENT", user_id=user_id, tier=tier, amount=amount_net, months=months,
                       reference=reference, note=note)
    inv = invoicing.invoice_subscription_payment(c, billing_event_id=ev, user_id=user_id)
    return {"subscription_id": sub_id, "invoice": inv}


def apply_addon_payment(c: Connection, *, org_id, code: str, name: str, amount_net, reference: str | None, user_id) -> dict:
    """يمدد الإضافة شهراً من نهايتها (أو من الآن) ويصدر فاتورة."""
    c.execute(text("""
        INSERT INTO org_addons (org_id, code, status, paid_until) VALUES (:o, :c, 'ACTIVE', now() + interval '1 month')
        ON CONFLICT (org_id, code) DO UPDATE SET status = 'ACTIVE',
            paid_until = GREATEST(org_addons.paid_until, now()) + interval '1 month'"""), {"o": org_id, "c": code})
    inv = invoicing._insert(c, kind="INVOICE", source="SUBSCRIPTION", org_id=org_id, buyer=invoicing._buyer(c, org_id),
                            lines=[line(f"{name} — اشتراك شهر", 1, amount_net)], user_id=user_id,
                            payment_reference=reference, plan_cycle="MONTHLY")
    return {"invoice": inv}


def org_contact(c: Connection, org_id: UUID | str) -> dict | None:
    row = c.execute(text("""SELECT u.full_name, u.email::text AS email, o.name AS org_name FROM memberships m
                            JOIN users u ON u.id = m.user_id JOIN organizations o ON o.id = m.org_id
                            WHERE m.org_id = :o AND m.role = 'ORG_ADMIN' AND m.is_active ORDER BY m.created_at LIMIT 1"""),
                    {"o": org_id}).mappings().one_or_none()
    return dict(row) if row else None
