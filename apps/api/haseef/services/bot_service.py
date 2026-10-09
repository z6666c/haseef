"""خدمة بوت الموظفين: تحديد المنشأة من رقم الجوال، بناء المعرفة المسموح بها، تطبيق الإجراءات، والسجل.

تعمل بدور المنصة (الويبهوك لا يعرف المنشأة مسبقاً)، لذا كل استعلام مقيّد صراحة بـ org_id.
"""

from __future__ import annotations

import json
import secrets
import string
from uuid import UUID

from sqlalchemy import Connection, text

from ..domain.bot import Policy, Reply, State, handle, norm
from . import pricing

ALPH = string.ascii_lowercase + string.digits


def new_code() -> str:
    return "".join(secrets.choice(ALPH) for _ in range(6))


def ensure_settings(c: Connection, org_id) -> dict:
    row = c.execute(text("SELECT * FROM bot_settings WHERE org_id = :o"), {"o": org_id}).mappings().one_or_none()
    if row is None:
        c.execute(text("INSERT INTO bot_settings (org_id, invite_code) VALUES (:o, :c) ON CONFLICT DO NOTHING"),
                  {"o": org_id, "c": new_code()})
        row = c.execute(text("SELECT * FROM bot_settings WHERE org_id = :o"), {"o": org_id}).mappings().one()
    return dict(row)


def questions_this_month(c: Connection, org_id) -> int:
    return c.execute(text("""SELECT count(*) FROM bot_messages WHERE org_id = :o AND direction = 'OUT' AND NOT simulated
                             AND intent IN ('ANSWER','NO_ANSWER','SENSITIVE')
                             AND created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh'"""),
                     {"o": org_id}).scalar_one()


def build_state(c: Connection, org_id, member: dict | None, access: dict, settings: dict) -> State:
    org = c.execute(text("SELECT name FROM organizations WHERE id = :o"), {"o": org_id}).scalar_one()
    pols = [Policy(str(r["id"]), r["title"], r["version"], r["body_md"] or "", r["employee_summary"]) for r in c.execute(text("""
        SELECT id, title, version, body_md, employee_summary FROM internal_policies
        WHERE org_id = :o AND status = 'ACTIVE' AND shared_with_employees ORDER BY title"""), {"o": org_id}).mappings()]
    faqs = [(str(r["id"]), r["question"], r["answer"]) for r in c.execute(text(
        "SELECT id, question, answer FROM bot_faqs WHERE org_id = :o AND is_active ORDER BY created_at"), {"o": org_id}).mappings()]
    acked: set[str] = set()
    if member:
        acked = {str(r[0]) for r in c.execute(text("""
            SELECT a.policy_id FROM policy_acknowledgments a JOIN internal_policies p ON p.id = a.policy_id AND p.version = a.policy_version
            WHERE a.member_id = :m"""), {"m": member["id"]})}
    limit = (access.get("limits") or {}).get("questions")
    quota = None if limit is None else limit - questions_this_month(c, org_id)
    return State(member["status"] if member else "ACTIVE", member["full_name"].split()[0] if member else "", org,
                 settings.get("hr_contact"), settings.get("welcome_text"), pols, faqs, acked, quota)


def _log(c: Connection, org_id, member_id, direction: str, body: str, *, intent=None, sources=None, simulated=False):
    c.execute(text("""INSERT INTO bot_messages (org_id, member_id, direction, body, intent, sources, simulated)
                      VALUES (:o, :m, :d, :b, :i, CAST(:s AS jsonb), :sim)"""),
              {"o": org_id, "m": member_id, "d": direction, "b": body[:4000], "i": intent,
               "s": json.dumps(sources or [], ensure_ascii=False), "sim": simulated})


def _apply(c: Connection, org_id, member: dict, r: Reply) -> None:
    a = r.action or {}
    if a.get("consent"):
        c.execute(text("UPDATE bot_members SET status = 'ACTIVE', consent_at = now() WHERE id = :m"), {"m": member["id"]})
    if a.get("opt_out"):
        c.execute(text("UPDATE bot_members SET status = 'REMOVED' WHERE id = :m"), {"m": member["id"]})
    if a.get("ack"):
        c.execute(text("""INSERT INTO policy_acknowledgments (org_id, policy_id, member_id, policy_version)
                          VALUES (:o, :p, :m, :v) ON CONFLICT DO NOTHING"""),
                  {"o": org_id, "p": a["ack"], "m": member["id"], "v": a["version"]})


def process_inbound(c: Connection, *, phone: str, body: str, profile_name: str | None = None) -> str | None:
    """رسالة واردة من واتساب. يُرجع نص الرد (أو None إن لم يلزم رد)."""
    member = c.execute(text("""SELECT id, org_id, full_name, status FROM bot_members WHERE phone = :p AND status <> 'REMOVED'"""),
                       {"p": phone}).mappings().one_or_none()
    if member is None:
        t = norm(body)
        code = t.split()[-1] if t.startswith(("انضمام", "join")) and len(t.split()) == 2 else None
        st = c.execute(text("SELECT * FROM bot_settings WHERE invite_code = :c AND enabled"), {"c": code}).mappings().one_or_none() if code else None
        access = pricing.addon_access(c, st["org_id"], "WA_BOT") if st else {}
        ok = bool(st and access.get("via"))
        state = State(None, org_name=c.execute(text("SELECT name FROM organizations WHERE id = :o"), {"o": st["org_id"]}).scalar_one() if ok else "")
        r = handle(body, state, join_code_ok=ok)
        if r.action and r.action.get("join") and ok:
            limit = (access.get("limits") or {}).get("members")
            n = c.execute(text("SELECT count(*) FROM bot_members WHERE org_id = :o AND status <> 'REMOVED'"), {"o": st["org_id"]}).scalar_one()
            if limit is not None and n >= limit:
                return "اكتمل عدد الموظفين المسموح في مساعد منشأتك. تواصل مع مسؤول المنشأة."
            status = "PENDING" if st["require_approval"] else "ACTIVE"
            mid = c.execute(text("""INSERT INTO bot_members (org_id, full_name, phone, status, joined_via, consent_at)
                                    VALUES (:o, :n, :p, :s, 'CODE', now()) RETURNING id"""),
                            {"o": st["org_id"], "n": (profile_name or "موظف")[:150], "p": phone, "s": status}).scalar_one()
            _log(c, st["org_id"], mid, "IN", body)
            _log(c, st["org_id"], mid, "OUT", r.text, intent="JOIN")
            if status == "ACTIVE":
                return f"تم انضمامك إلى مساعد {state.org_name}. اكتب «مساعدة» لمعرفة ما يمكنني فعله."
        return r.text
    org_id = member["org_id"]
    settings = ensure_settings(c, org_id)
    access = pricing.addon_access(c, org_id, "WA_BOT")
    if not access.get("via") or not settings["enabled"]:
        return "مساعد الموظفين غير مفعّل لمنشأتك حالياً."
    r = handle(body, build_state(c, org_id, dict(member), access, settings))
    if r.action and r.action.get("attend"):
        r.text = attendance_reply(c, org_id, member["id"])
    if r.action and r.action.get("hr"):
        r.text = hr_reply(c, org_id, member["id"], r.action["hr"])
    _log(c, org_id, member["id"], "IN", body)
    _apply(c, org_id, dict(member), r)
    _log(c, org_id, member["id"], "OUT", r.text, intent=r.intent, sources=r.sources)
    return r.text


def attendance_reply(c: Connection, org_id, member_id) -> str:
    """«حضور» في واتساب: رابط شخصي جديد لتسجيل الحضور (يتطلب ربط رقم الموظف بسجله وتفعيل خدمة الحضور)."""
    from ..routers.attendance import issue_link
    if not pricing.addon_access(c, org_id, "ATTENDANCE")["via"]:
        return "خدمة تسجيل الحضور غير مفعّلة لمنشأتك."
    emp = c.execute(text("SELECT employee_id FROM bot_members WHERE id = :m"), {"m": member_id}).scalar_one_or_none()
    if not emp:
        return "رقمك غير مربوط بسجلك الوظيفي. اطلب من الموارد البشرية ربطه من صفحة بوت الموظفين."
    url = issue_link(c, org_id, emp)
    return f"رابط تسجيل الحضور والانصراف الخاص بك (لا تشاركه):\n{url}\nسيطلب منك الموقع وبصمة جوالك."


def hr_reply(c: Connection, org_id, member_id, what: str) -> str:
    """«إجازة» و«رصيدي» و«إشعاراتي»: ضمن إضافة الحضور والإجازات."""
    from ..domain.hr import fmt_days
    from ..routers.attendance import issue_link
    from . import hr_service
    if not pricing.addon_access(c, org_id, "ATTENDANCE")["via"]:
        return "خدمة الإجازات غير مفعّلة لمنشأتك. تواصل مع الموارد البشرية."
    emp = c.execute(text("SELECT employee_id FROM bot_members WHERE id = :m"), {"m": member_id}).scalar_one_or_none()
    if not emp:
        return "رقمك غير مربوط بسجلك الوظيفي. اطلب من الموارد البشرية ربطه من صفحة بوت الموظفين."
    if what == "balance":
        e = hr_service.employee(c, org_id, emp)
        b = hr_service.balance(c, org_id, e, hr_service.today().year)
        pend = c.execute(text("SELECT count(*) FROM leave_requests WHERE employee_id = :e AND status = 'PENDING'"), {"e": emp}).scalar_one()
        return (f"رصيد إجازتك السنوية لعام {b['year']}: {fmt_days(b['balance'])} يوم\n"
                f"(الاستحقاق {b['entitlement']}، المستخدم {b['used']}{'، تعديلات ' + fmt_days(b['adjustments']) if b['adjustments'] else ''})"
                + (f"\nلديك {pend} طلب بانتظار القرار." if pend else "") + "\nلرفع إجازة اكتب «إجازة».")
    url = issue_link(c, org_id, emp) + ("&tab=notices" if what == "notices" else "&tab=leave")
    if what == "notices":
        n = c.execute(text("SELECT count(*) FROM deduction_notices WHERE employee_id = :e AND status = 'ISSUED'"), {"e": emp}).scalar_one()
        return (f"لديك {n} إشعار خصم قائم." if n else "لا توجد إشعارات خصم قائمة.") + f"\nللاطلاع أو الاعتراض (لا تشارك الرابط):\n{url}"
    return f"رابط الإجازات الخاص بك (لا تشاركه): ارفع إجازة سنوية أو اعتيادية أو اضطرارية أو مرضية، أو سجّل مباشرتك بعد العودة:\n{url}"


def simulate(c: Connection, org_id: UUID, *, member_id: UUID | None, body: str) -> dict:
    """تجربة المحادثة من داخل حصيف دون واتساب. مع عضو محدد تُطبق الإجراءات فعلياً (مثل الإقرار)."""
    settings = ensure_settings(c, org_id)
    access = pricing.addon_access(c, org_id, "WA_BOT")
    member = None
    if member_id:
        member = c.execute(text("SELECT id, org_id, full_name, status FROM bot_members WHERE id = :m AND org_id = :o"),
                           {"m": member_id, "o": org_id}).mappings().one_or_none()
        member = dict(member) if member else None
    state = build_state(c, org_id, member, access, settings)
    if member is None:
        state.member_name = "تجربة"
    r = handle(body, state)
    if r.action and r.action.get("attend"):
        r.text = attendance_reply(c, org_id, member["id"]) if member else "في التجربة بصفة المدير لا يوجد سجل موظف. اختر موظفاً مربوطاً لتجربة رابط الحضور."
    if r.action and r.action.get("hr"):
        r.text = hr_reply(c, org_id, member["id"], r.action["hr"]) if member else "في التجربة بصفة المدير لا يوجد سجل موظف. اختر موظفاً مربوطاً لتجربة الإجازات."
    if member:
        _apply(c, org_id, member, r)
    _log(c, org_id, member["id"] if member else None, "IN", body, simulated=True)
    _log(c, org_id, member["id"] if member else None, "OUT", r.text, intent=r.intent, sources=r.sources, simulated=True)
    return {"reply": r.text, "intent": r.intent, "sources": r.sources}
