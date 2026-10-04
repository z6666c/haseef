"""إصدار الفواتير الضريبية والإشعارات الدائنة لإيرادات حصيف.

تُصدر تلقائياً عند تسجيل دفعة اشتراك أو دفع استشارة، ولا تُعدَّل بعد الإصدار (قيد في قاعدة البيانات):
التصحيح أو الاسترداد بإشعار دائن يحمل رقماً مستقلاً ويُشير للفاتورة الأصلية.

مبالغ الاشتراكات المسجلة في غرفة العمليات قبل الضريبة (مثل أسعار الباقات)، وتُضاف إليها 15%.
أسعار الاستشارات مخزنة شاملة الضريبة في عرض السعر المجمّد وقت الطلب.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Connection, text

from ..domain.finance import invoice_number, line, r2, zatca_tlv

PLAN_NAME = {"ESSENTIAL": "باقة الأساس", "PROFESSIONAL_GRC": "باقة الحوكمة والنمو", "ENTERPRISE": "باقة كبار العملاء"}
TOPIC_NAME = {"CORPORATE": "الشركات والحوكمة", "CONTRACTS": "العقود التجارية", "LABOR": "العمل والموارد البشرية",
              "PDPL": "حماية البيانات الشخصية", "COMPLIANCE": "التراخيص والامتثال", "RESTRUCTURING": "إعادة الهيكلة والاندماج",
              "DISPUTES": "النزاعات والتقاضي"}


def seller(conn: Connection) -> dict:
    p = conn.execute(text("""SELECT legal_name, trade_name, vat_registered, vat_number, cr_number, address, email, phone, iban, invoice_note
                             FROM haseef_profile WHERE id = 1""")).mappings().one()
    return dict(p)


def _buyer(conn: Connection, org_id: UUID) -> dict:
    return dict(conn.execute(text("SELECT name, cr_number FROM organizations WHERE id = :o"), {"o": org_id}).mappings().one())


def _insert(conn: Connection, *, kind: str, source: str, org_id, buyer: dict, lines: list[dict], user_id,
            billing_event_id=None, consultation_id=None, related=None, payment_reference=None, note=None,
            mirror: dict | None = None) -> dict:
    s = seller(conn)
    if mirror:                                      # الإشعار الدائن يطابق مبالغ الفاتورة الأصلية حرفياً
        sub, vat, rate = r2(mirror["subtotal"]), r2(mirror["vat_amount"]), mirror["vat_rate"]
    else:
        rate = Decimal("0.15") if s["vat_registered"] else Decimal("0")
        if not s["vat_registered"]:                 # غير مسجّل في الضريبة: لا تُحصَّل ضريبة
            lines = [{**l, "vat": 0.0, "total": l["net"]} for l in lines]
        sub = r2(sum(Decimal(str(l["net"])) for l in lines))
        vat = r2(sum(Decimal(str(l["vat"])) for l in lines))
    seq = conn.execute(text("SELECT nextval('invoice_number_seq')") if kind == "INVOICE"
                       else text("SELECT nextval('credit_note_number_seq')")).scalar_one()
    issued = datetime.now(timezone.utc).replace(microsecond=0)
    number = invoice_number(kind, issued.year, seq)
    qr = zatca_tlv(s["legal_name"], s["vat_number"], issued.isoformat().replace("+00:00", "Z"), sub + vat, vat) \
        if s["vat_registered"] and s["vat_number"] else None
    row = conn.execute(text("""
        INSERT INTO invoices (number, kind, source, org_id, billing_event_id, consultation_id, related_invoice_id,
                              buyer_name, buyer_cr, seller, lines, subtotal, vat_rate, vat_amount, total,
                              payment_reference, note, qr, issued_at, created_by)
        VALUES (:number, :kind, :source, :org, :be, :cid, :rel, :bn, :bcr, CAST(:seller AS jsonb), CAST(:lines AS jsonb),
                :sub, :rate, :vat, :total, :ref, :note, :qr, :issued, :u)
        RETURNING id, number, total"""),
        {"number": number, "kind": kind, "source": source, "org": org_id, "be": billing_event_id, "cid": consultation_id,
         "rel": related, "bn": buyer["name"], "bcr": buyer.get("cr_number"), "seller": json.dumps(s, ensure_ascii=False),
         "lines": json.dumps(lines, ensure_ascii=False), "sub": sub, "rate": rate,
         "vat": vat, "total": sub + vat, "ref": payment_reference, "note": note, "qr": qr, "issued": issued,
         "u": user_id}).mappings().one()
    return dict(row)


def invoice_subscription_payment(conn: Connection, *, billing_event_id: int, user_id, description: str | None = None) -> dict:
    ev = conn.execute(text("""SELECT org_id, plan_tier, amount_sar, period_months, reference FROM billing_events WHERE id = :e"""),
                      {"e": billing_event_id}).mappings().one()
    months = ev["period_months"]
    desc = f"اشتراك {PLAN_NAME.get(ev['plan_tier'], ev['plan_tier'])} — {'سنة' if months == 12 else f'{months} شهر' if months > 2 else 'شهر'}"
    return _insert(conn, kind="INVOICE", source="SUBSCRIPTION", org_id=ev["org_id"], buyer=_buyer(conn, ev["org_id"]),
                   lines=[line(description or desc, 1, ev["amount_sar"])], user_id=user_id, billing_event_id=billing_event_id,
                   payment_reference=ev["reference"])


def invoice_consultation(conn: Connection, *, consultation_id: UUID, user_id, reference: str | None) -> dict | None:
    existing = conn.execute(text("SELECT id FROM invoices WHERE consultation_id = :c AND kind = 'INVOICE'"),
                            {"c": consultation_id}).scalar_one_or_none()
    if existing:
        return None
    c = conn.execute(text("""SELECT org_id, topic, duration_minutes, urgent, price FROM legal_consultations WHERE id = :c"""),
                     {"c": consultation_id}).mappings().one()
    price = c["price"]
    hours = c["duration_minutes"] / 60
    desc = f"استشارة قانونية — {TOPIC_NAME.get(c['topic'], c['topic'])} ({hours:g} ساعة{'، عاجلة' if c['urgent'] else ''})"
    ln = line(desc, 1, price["subtotal"])
    return _insert(conn, kind="INVOICE", source="CONSULTATION", org_id=c["org_id"], buyer=_buyer(conn, c["org_id"]),
                   lines=[ln], user_id=user_id, consultation_id=consultation_id, payment_reference=reference)


def credit_note(conn: Connection, *, invoice_id: UUID, reason: str, user_id) -> dict:
    inv = conn.execute(text("""SELECT id, number, kind, status, source, org_id, buyer_name, buyer_cr, lines, consultation_id,
                                      subtotal, vat_amount, vat_rate
                               FROM invoices WHERE id = :i FOR UPDATE"""), {"i": invoice_id}).mappings().one_or_none()
    if inv is None or inv["kind"] != "INVOICE":
        raise LookupError("الفاتورة غير موجودة")
    if inv["status"] == "VOID":
        raise ValueError("الفاتورة ملغاة أصلاً")
    lines = [{**l, "description": f"إلغاء: {l['description']}"} for l in inv["lines"]]
    cn = _insert(conn, kind="CREDIT_NOTE", source=inv["source"], org_id=inv["org_id"],
                 buyer={"name": inv["buyer_name"], "cr_number": inv["buyer_cr"]}, lines=lines, user_id=user_id,
                 related=inv["id"], note=f"إشعار دائن للفاتورة {inv['number']}: {reason}", mirror=dict(inv))
    conn.execute(text("UPDATE invoices SET status = 'VOID', void_reason = :r WHERE id = :i"), {"r": reason, "i": invoice_id})
    return cn
