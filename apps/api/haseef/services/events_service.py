"""تهاني المناسبات السنوية عبر واتساب (مجانية على حصيف).

  * للمشتركين: لكل مستخدم في المنشآت النشطة فعّل قناة واتساب في التنبيهات (مرة واحدة لكل رقم).
  * للموظفين: فقط للمنشآت التي فعّلت ذلك، إلى جوال الموظف في سجله أو رقمه في بوت الموظفين.
القالب haseef_greeting (تسويقي لدى Meta): {{1}} الاسم، {{2}} نص التهنئة، {{3}} التوقيع.
"""

from __future__ import annotations

import logging
from datetime import date

from sqlalchemy import text

log = logging.getLogger(__name__)
TEMPLATE = "haseef_greeting"


def _send(conn, sender, *, event: dict, org_id, audience: str, phone: str, name: str, signature: str) -> bool:
    phone = phone.strip()
    done = conn.execute(text("SELECT 1 FROM event_sends WHERE event_id = :e AND audience = :a AND recipient = :p"),
                        {"e": event["id"], "a": audience, "p": phone}).first()
    if done:
        return False
    try:
        sender.send(phone, TEMPLATE, [name.split()[0] if name else "", event["greeting"], signature])
        st, err = "SENT", None
    except Exception as e:  # noqa: BLE001
        st, err = "FAILED", str(e)[:300]
        log.warning("greeting failed %s: %s", phone, e)
    conn.execute(text("""INSERT INTO event_sends (org_id, event_id, audience, recipient, status, error) VALUES (:o, :e, :a, :p, :s, :err)
                         ON CONFLICT DO NOTHING"""), {"o": org_id, "e": event["id"], "a": audience, "p": phone, "s": st, "err": err})
    return st == "SENT"


def send_today(tx, sender, today: date) -> int:
    """يُشغَّل صباح كل يوم. آمن للتكرار: لا يُرسل للرقم نفسه مرتين عن المناسبة نفسها."""
    sent = 0
    with tx() as conn:
        events = [dict(r) for r in conn.execute(text("SELECT * FROM annual_events WHERE is_active AND event_date = :d"), {"d": today}).mappings()]
    for ev in events:
        if ev["notify_subscribers"]:
            with tx() as conn:
                for r in conn.execute(text("""SELECT DISTINCT ON (r.phone) r.org_id, r.full_name, r.phone FROM v_alert_recipients r
                                              JOIN organizations o ON o.id = r.org_id AND o.is_active
                                              WHERE r.phone IS NOT NULL AND 'WHATSAPP' = ANY(r.channels)""")).mappings().all():
                    sent += _send(conn, sender, event=ev, org_id=r["org_id"], audience="SUBSCRIBER", phone=r["phone"], name=r["full_name"],
                                  signature="فريق حصيف")
        with tx() as conn:
            orgs = conn.execute(text("""SELECT s.org_id, COALESCE(s.signature, o.name) AS signature FROM org_event_settings s
                                        JOIN organizations o ON o.id = s.org_id AND o.is_active
                                        WHERE s.enabled AND NOT (:c = ANY(s.excluded_codes))"""), {"c": ev["code"]}).mappings().all()
        for org in orgs:
            with tx() as conn:
                for r in conn.execute(text("""SELECT e.full_name, COALESCE(e.mobile, b.phone) AS phone FROM org_employees e
                                              LEFT JOIN LATERAL (SELECT phone FROM bot_members WHERE employee_id = e.id AND status = 'ACTIVE' LIMIT 1) b ON true
                                              WHERE e.org_id = :o AND e.is_active AND COALESCE(e.mobile, b.phone) IS NOT NULL"""),
                                      {"o": org["org_id"]}).mappings().all():
                    sent += _send(conn, sender, event=ev, org_id=org["org_id"], audience="EMPLOYEE", phone=r["phone"], name=r["full_name"],
                                  signature=org["signature"])
    return sent
