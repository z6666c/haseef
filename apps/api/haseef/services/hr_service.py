"""خدمة الموارد البشرية: الإجازات (سنوية/اعتيادية/اضطرارية) والمباشرة وإشعارات الخصم.

تُستدعى من لوحة الموارد البشرية (اتصال المنشأة) ومن صفحة الموظف العامة والبوت (اتصال المنصة)،
لذا كل استعلام مقيّد صراحة بـ org_id حتى لا يعتمد على سياق RLS.
"""

from __future__ import annotations

import base64
import binascii
import logging
import uuid
from datetime import date, datetime, time, timedelta
from pathlib import Path
from decimal import Decimal
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import Connection, text

from ..domain import hr

log = logging.getLogger(__name__)
RIYADH = ZoneInfo("Asia/Riyadh")


def today() -> date:
    return datetime.now(RIYADH).date()


def hr_settings(c: Connection, org_id) -> dict:
    row = c.execute(text("SELECT * FROM hr_settings WHERE org_id = :o"), {"o": org_id}).mappings().one_or_none()
    if row is None:
        c.execute(text("INSERT INTO hr_settings (org_id) VALUES (:o) ON CONFLICT DO NOTHING"), {"o": org_id})
        row = c.execute(text("SELECT * FROM hr_settings WHERE org_id = :o"), {"o": org_id}).mappings().one()
    return dict(row)


def policies(c: Connection, org_id) -> dict[str, dict]:
    rows = {r["leave_type"]: dict(r) for r in c.execute(text("SELECT * FROM hr_leave_policies WHERE org_id = :o"), {"o": org_id}).mappings()}
    for t in hr.LEAVE_TYPES:
        if t not in rows:
            d = hr.DEFAULT_POLICIES[t]
            c.execute(text("""INSERT INTO hr_leave_policies (org_id, leave_type, pay_mode, is_paid, from_balance, max_days_per_request, yearly_cap, min_notice_days)
                              VALUES (:o, :t, :pm, :p, :b, :m, :y, :n) ON CONFLICT DO NOTHING"""),
                      {"o": org_id, "t": t, "pm": d["pay_mode"], "p": d["is_paid"], "b": d["from_balance"], "m": d["max_days_per_request"],
                       "y": d["yearly_cap"], "n": d["min_notice_days"]})
            rows[t] = {"org_id": org_id, "leave_type": t, "is_active": True, **d}
    return rows


def work_calendar(c: Connection, org_id) -> tuple[list[int], set[date], int]:
    """أيام العمل، والعطل الرسمية، ودقائق الدوام اليومية (من إعدادات الحضور)."""
    s = c.execute(text("SELECT work_days, work_start, work_end FROM attendance_settings WHERE org_id = :o"), {"o": org_id}).mappings().one_or_none()
    work_days = list(s["work_days"]) if s else [0, 1, 2, 3, 4]
    minutes = 480
    if s:
        a, b = s["work_start"], s["work_end"]
        minutes = max((b.hour * 60 + b.minute) - (a.hour * 60 + a.minute), 60)
    events = [dict(r) for r in c.execute(text("SELECT event_date, is_holiday, holiday_days, is_active FROM annual_events WHERE is_holiday AND is_active"))
              .mappings()]
    return work_days, hr.holiday_dates(events), minutes


def _f(v):
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (datetime, date, time)):
        return v.isoformat()
    return v


def row(r) -> dict:
    return {k: _f(v) for k, v in dict(r).items()}


def employee(c: Connection, org_id, emp_id) -> dict:
    e = c.execute(text("""SELECT id, full_name, start_date, basic_wage, housing_allowance, mobile FROM org_employees
                          WHERE id = :e AND org_id = :o AND is_active"""), {"e": emp_id, "o": org_id}).mappings().one_or_none()
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الموظف غير موجود")
    return dict(e)


def used_days(c: Connection, emp_id, year: int, types: tuple[str, ...], paid_only: bool = False) -> int:
    return int(c.execute(text("""SELECT COALESCE(sum(days), 0) FROM leave_requests WHERE employee_id = :e AND status IN ('PENDING','APPROVED')
                                AND leave_type = ANY(:t) AND extract(year FROM start_date) = :y AND (is_paid OR NOT :po)"""),
                         {"e": emp_id, "t": list(types), "y": year, "po": paid_only}).scalar_one())


def balance(c: Connection, org_id, emp: dict, year: int, pols: dict[str, dict] | None = None) -> dict:
    pols = pols or policies(c, org_id)
    ent = hr.annual_entitlement(emp["start_date"], date(year, 12, 31))
    adj = float(c.execute(text("SELECT COALESCE(sum(days), 0) FROM leave_adjustments WHERE employee_id = :e AND year = :y"),
                          {"e": emp["id"], "y": year}).scalar_one())
    from_bal = tuple(t for t, p in pols.items() if p["from_balance"])
    used = used_days(c, emp["id"], year, from_bal, paid_only=True) if from_bal else 0
    return {"year": year, "entitlement": ent, "adjustments": adj, "used": used, "balance": round(ent + adj - used, 1)}


def decode_attachment(att: dict | None) -> tuple[bytes, str, str] | None:
    """يتحقق من المرفق قبل أي كتابة: الحجم، والنوع من محتوى الملف (PDF/JPEG/PNG فقط)."""
    if not att:
        return None
    try:
        data = base64.b64decode(att.get("file_base64") or "", validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "تعذّرت قراءة المرفق")
    if not data:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "المرفق فارغ")
    if len(data) > hr.ATTACH_MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "حجم المرفق يتجاوز 6 ميجابايت")
    mime = hr.sniff_mime(data)
    if mime is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "المرفق يجب أن يكون صورة (JPG/PNG) أو PDF")
    return data, mime, hr.safe_file_name(att.get("file_name") or "", mime)


def _save_attachment(c: Connection, org_id, leave_id, decoded: tuple[bytes, str, str]) -> None:
    from ..config import get_settings
    data, mime, name = decoded
    root = Path(get_settings().storage_dir)
    old = c.execute(text("SELECT attachment_key FROM leave_requests WHERE id = :i AND org_id = :o"), {"i": leave_id, "o": org_id}).scalar_one_or_none()
    key = f"leave/{org_id}/{uuid.uuid4().hex}{hr.ATTACH_EXT[mime]}"
    path = root / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    c.execute(text("""UPDATE leave_requests SET attachment_key = :k, attachment_name = :n, attachment_mime = :m, attachment_size = :z,
                      attachment_at = now() WHERE id = :i AND org_id = :o"""),
              {"k": key, "n": name, "m": mime, "z": len(data), "i": leave_id, "o": org_id})
    if old:
        try:
            (root / old).unlink(missing_ok=True)
        except OSError:
            log.warning("could not remove old attachment %s", old)


def attach(c: Connection, org_id, emp_id, leave_id, att: dict) -> None:
    """إرفاق التقرير بعد رفع الطلب (أو استبداله) ما دام الطلب لم يُبت فيه."""
    st = c.execute(text("SELECT status FROM leave_requests WHERE id = :i AND org_id = :o AND employee_id = :e"),
                   {"i": leave_id, "o": org_id, "e": emp_id}).scalar_one_or_none()
    if st is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الطلب غير موجود")
    if st != "PENDING":
        raise HTTPException(status.HTTP_409_CONFLICT, "يُرفق التقرير قبل البت في الطلب فقط. تواصل مع الموارد البشرية.")
    _save_attachment(c, org_id, leave_id, decode_attachment(att))


def create_leave(c: Connection, org_id, emp_id, *, leave_type: str, start: date, end: date, reason: str | None,
                 source: str, by_hr: bool, user_id=None, approve: bool = False, medical_ref: str | None = None,
                 attachment: dict | None = None, is_paid: bool | None = None) -> dict:
    emp = employee(c, org_id, emp_id)
    pols = policies(c, org_id)
    if leave_type not in pols:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "نوع الإجازة غير معروف")
    s = hr_settings(c, org_id)
    wd, hol, _ = work_calendar(c, org_id)
    days = hr.count_days(start, end, work_days=wd, holidays=hol, workdays_only=s["count_workdays_only"] and leave_type != "SICK")  # المرضية بالأيام التقويمية
    bal = balance(c, org_id, emp, start.year, pols)
    paid = hr.resolve_paid(pols[leave_type], is_paid)
    err = hr.validate_leave(leave_type=leave_type, start=start, end=end, days=days, today=today(), policy=pols[leave_type], by_hr=by_hr, is_paid=paid,
                            balance=bal["balance"], used_this_year_type=used_days(c, emp_id, start.year, (leave_type,)))
    if err:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, err)
    if c.execute(text("""SELECT 1 FROM leave_requests WHERE employee_id = :e AND status IN ('PENDING','APPROVED')
                         AND start_date <= :end AND end_date >= :start"""), {"e": emp_id, "start": start, "end": end}).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "يوجد طلب إجازة آخر يتداخل مع هذه الفترة")
    decoded = decode_attachment(attachment)
    if leave_type == "SICK" and not by_hr and decoded is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "أرفق التقرير الطبي (صورة أو PDF) للإجازة المرضية")
    st = "APPROVED" if approve else "PENDING"
    lid = c.execute(text("""INSERT INTO leave_requests (org_id, employee_id, leave_type, start_date, end_date, days, reason, medical_ref, is_paid, status, source,
                                                        decided_by, decided_at)
                            VALUES (:o, :e, :t, :s, :en, :d, :r, :mr, :paid, :st, :src, :u, CASE WHEN :ap THEN now() END) RETURNING id"""),
                    {"o": org_id, "e": emp_id, "t": leave_type, "s": start, "en": end, "d": days, "r": reason, "mr": (medical_ref or "").strip() or None,
                     "st": st, "paid": paid, "ap": approve, "src": source, "u": user_id if approve else None}).scalar_one()
    if decoded:
        _save_attachment(c, org_id, lid, decoded)
    out = {"id": lid, "days": days, "status": st, "is_paid": paid, "has_attachment": decoded is not None}
    if leave_type == "SICK":
        out["pay_note"] = hr.sick_note(used_days(c, emp_id, start.year, ("SICK",)) - days, days)
    return out


def annotate_sick(leaves: list[dict]) -> None:
    """يضيف لكل إجازة مرضية توزيعها على شرائح الأجر بحسب ترتيبها في سنتها (المادة 117)."""
    used: dict[tuple, int] = {}
    for l in sorted(leaves, key=lambda x: x["start_date"]):
        if l["leave_type"] != "SICK" or l["status"] not in ("PENDING", "APPROVED"):
            continue
        k = (str(l["employee_id"]) if "employee_id" in l else "", str(l["start_date"])[:4])
        l["pay_note"] = hr.sick_note(used.get(k, 0), l["days"])
        used[k] = used.get(k, 0) + l["days"]


def decide_leave(c: Connection, org_id, leave_id, *, approve: bool, note: str | None, user_id, is_paid: bool | None = None) -> dict:
    lr = c.execute(text("SELECT * FROM leave_requests WHERE id = :i AND org_id = :o"), {"i": leave_id, "o": org_id}).mappings().one_or_none()
    if lr is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الطلب غير موجود")
    if lr["status"] != "PENDING":
        raise HTTPException(status.HTTP_409_CONFLICT, "تم البت في هذا الطلب مسبقاً")
    st = "APPROVED" if approve else "REJECTED"
    paid = lr["is_paid"]
    if approve and is_paid is not None and is_paid != paid:
        # الموارد البشرية تعتمدها بأجر أو بدونه (مثلاً عند عدم كفاية الرصيد) إن سمحت سياسة النوع بالاختيار
        pol = policies(c, org_id)[lr["leave_type"]]
        if pol["pay_mode"] != "CHOICE":
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "سياسة هذا النوع لا تسمح بتغيير الأجر")
        if is_paid and pol["from_balance"]:
            bal = balance(c, org_id, employee(c, org_id, lr["employee_id"]), lr["start_date"].year)["balance"]
            if lr["days"] > bal:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"الرصيد غير كافٍ: المتبقي {hr.fmt_days(bal)} يوم")
        paid = is_paid
    c.execute(text("""UPDATE leave_requests SET status = :s, decided_by = :u, decided_at = now(), decision_note = :n, is_paid = :p WHERE id = :i"""),
              {"s": st, "u": user_id, "n": note, "p": paid, "i": leave_id})
    label = hr.LEAVE_LABEL[lr["leave_type"]] + ("" if paid else " (بدون أجر)")
    msg = (f"تمت الموافقة على إجازتك ال{label} من {lr['start_date']:%Y-%m-%d} إلى {lr['end_date']:%Y-%m-%d}. نرجو تسجيل المباشرة عند عودتك."
           if approve else f"نعتذر، لم تتم الموافقة على إجازتك ال{label} من {lr['start_date']:%Y-%m-%d}." + (f" الملاحظة: {note}" if note else ""))
    notify(c, org_id, lr["employee_id"], msg)
    return {"status": st}


def submit_return(c: Connection, org_id, emp_id, leave_id, return_date: date, *, by_hr: bool, user_id=None) -> dict:
    lr = c.execute(text("SELECT * FROM leave_requests WHERE id = :i AND org_id = :o AND employee_id = :e"),
                   {"i": leave_id, "o": org_id, "e": emp_id}).mappings().one_or_none()
    if lr is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الطلب غير موجود")
    if lr["status"] != "APPROVED":
        raise HTTPException(status.HTTP_409_CONFLICT, "المباشرة تكون بعد إجازة موافق عليها")
    if lr["return_confirmed_at"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "أُكدت المباشرة مسبقاً")
    if return_date <= lr["start_date"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "تاريخ المباشرة يجب أن يكون بعد بداية الإجازة")
    if not by_hr and return_date > today():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "تُسجَّل المباشرة يوم عودتك للعمل، لا قبله")
    if by_hr:
        c.execute(text("""UPDATE leave_requests SET return_date = :d, return_submitted_at = COALESCE(return_submitted_at, now()),
                          return_confirmed_at = now(), return_confirmed_by = :u WHERE id = :i"""), {"d": return_date, "u": user_id, "i": leave_id})
    else:
        c.execute(text("UPDATE leave_requests SET return_date = :d, return_submitted_at = now() WHERE id = :i"), {"d": return_date, "i": leave_id})
    wd, hol, _ = work_calendar(c, org_id)
    late = hr.late_return_days(lr["end_date"], return_date, work_days=wd, holidays=hol)
    return {"late_days": late}


def month_sums(c: Connection, emp_id, month: date, exclude=None) -> tuple[float, float]:
    r = c.execute(text("""SELECT COALESCE(sum(amount) FILTER (WHERE kind = ANY(:f)), 0) AS fines, COALESCE(sum(amount), 0) AS total
                          FROM deduction_notices WHERE employee_id = :e AND payroll_month = :m AND status IN ('ISSUED','OBJECTED','CONFIRMED')
                          AND (CAST(:x AS uuid) IS NULL OR id <> CAST(:x AS uuid))"""),
                  {"e": emp_id, "m": month, "f": list(hr.FINE_KINDS), "x": str(exclude) if exclude else None}).mappings().one()
    return float(r["fines"]), float(r["total"])


def create_notice(c: Connection, org_id, emp_id, *, kind: str, incident: date, description: str, amount: float, payroll_month: date,
                  user_id, leave_request_id=None) -> dict:
    emp = employee(c, org_id, emp_id)
    dw = hr.daily_wage(emp["basic_wage"], emp["housing_allowance"])
    fines, total = month_sums(c, emp_id, payroll_month)
    err = hr.validate_deduction(kind=kind, amount=amount, incident=incident, today=today(), dwage=dw,
                                monthly_wage=float(emp["basic_wage"]) + float(emp["housing_allowance"]), month_fines=fines, month_total=total)
    if err:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, err)
    nid = c.execute(text("""INSERT INTO deduction_notices (org_id, employee_id, kind, incident_date, description, amount, payroll_month,
                                                           leave_request_id, created_by)
                            VALUES (:o, :e, :k, :i, :d, :a, :m, :l, :u) RETURNING id"""),
                    {"o": org_id, "e": emp_id, "k": kind, "i": incident, "d": description, "a": amount, "m": payroll_month,
                     "l": leave_request_id, "u": user_id}).scalar_one()
    s = hr_settings(c, org_id)
    notify(c, org_id, emp_id, f"صدر بحقك إشعار خصم ({hr.KIND_LABEL[kind]}) بمبلغ {amount:.2f} ريال عن واقعة {incident:%Y-%m-%d}. "
                              f"يمكنك الاطلاع عليه والاعتراض خلال {s['objection_days']} يوماً من رابطك الشخصي أو بكتابة «إشعاراتي» للمساعد.")
    return {"id": nid}


def object_notice(c: Connection, org_id, emp_id, notice_id, objection: str) -> None:
    n = c.execute(text("SELECT status, created_at FROM deduction_notices WHERE id = :i AND org_id = :o AND employee_id = :e"),
                  {"i": notice_id, "o": org_id, "e": emp_id}).mappings().one_or_none()
    if n is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الإشعار غير موجود")
    if n["status"] != "ISSUED":
        raise HTTPException(status.HTTP_409_CONFLICT, "لا يمكن الاعتراض على هذا الإشعار الآن")
    days = hr_settings(c, org_id)["objection_days"]
    if datetime.now(RIYADH) - n["created_at"] > timedelta(days=days):
        raise HTTPException(status.HTTP_409_CONFLICT, f"انتهت مهلة الاعتراض ({days} يوماً)")
    c.execute(text("UPDATE deduction_notices SET status = 'OBJECTED', objection_text = :t, objected_at = now() WHERE id = :i"),
              {"t": objection, "i": notice_id})


def decide_notice(c: Connection, org_id, notice_id, *, confirm: bool, note: str | None, user_id) -> None:
    n = c.execute(text("SELECT employee_id, status, kind, amount FROM deduction_notices WHERE id = :i AND org_id = :o"),
                  {"i": notice_id, "o": org_id}).mappings().one_or_none()
    if n is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الإشعار غير موجود")
    if n["status"] not in ("ISSUED", "OBJECTED"):
        raise HTTPException(status.HTTP_409_CONFLICT, "تم البت في هذا الإشعار مسبقاً")
    c.execute(text("""UPDATE deduction_notices SET status = :s, decided_at = now(), decided_by = :u, decision_note = :n WHERE id = :i"""),
              {"s": "CONFIRMED" if confirm else "CANCELLED", "u": user_id, "n": note, "i": notice_id})
    if n["status"] == "OBJECTED" or not confirm:
        msg = (f"تم النظر في اعتراضك وتأكيد الخصم ({float(n['amount']):.2f} ريال)." if confirm else f"أُلغي إشعار الخصم ({hr.KIND_LABEL[n['kind']]}).") \
            + (f" الملاحظة: {note}" if note else "")
        notify(c, org_id, n["employee_id"], msg)


def notify(c: Connection, org_id, emp_id, message: str) -> bool:
    """إشعار واتساب للموظف (جواله في سجله أو رقمه في بوت الموظفين). الفشل لا يوقف العملية."""
    try:
        if not hr_settings(c, org_id)["notify_employees"]:
            return False
        r = c.execute(text("""SELECT e.full_name, e.mobile, o.name AS org_name,
                                     (SELECT b.phone FROM bot_members b WHERE b.employee_id = e.id AND b.status = 'ACTIVE' LIMIT 1) AS bot_phone
                              FROM org_employees e JOIN organizations o ON o.id = e.org_id WHERE e.id = :e AND e.org_id = :o"""),
                      {"e": emp_id, "o": org_id}).mappings().one_or_none()
        phone = r and (r["mobile"] or r["bot_phone"])
        if not phone:
            return False
        from ..config import get_settings
        from ..messaging import build_senders
        build_senders(get_settings())["WHATSAPP"].send(phone, "haseef_hr_update", [r["full_name"].split()[0], r["org_name"], message[:900]])
        return True
    except Exception as e:  # noqa: BLE001 — الإشعار مساعد وليس شرطاً
        log.warning("hr notify failed: %s", e)
        return False


def employee_view(c: Connection, org_id, emp_id) -> dict:
    """ما يراه الموظف في رابطه: رصيده وطلباته وإشعاراته."""
    emp = employee(c, org_id, emp_id)
    pols = policies(c, org_id)
    s = hr_settings(c, org_id)
    y = today().year
    leaves = [row(r) for r in c.execute(text("""SELECT id, leave_type, start_date, end_date, days, reason, medical_ref, is_paid,
                                                       attachment_name, (attachment_key IS NOT NULL) AS has_attachment, status, source, decision_note,
                                                       return_date, return_submitted_at, return_confirmed_at, created_at
                                                FROM leave_requests WHERE employee_id = :e AND org_id = :o ORDER BY start_date DESC LIMIT 30"""),
                                      {"e": emp_id, "o": org_id}).mappings()]
    annotate_sick(leaves)
    for lv in leaves:
        lv["label"] = hr.LEAVE_LABEL[lv["leave_type"]]
    notices = [row(r) for r in c.execute(text("""SELECT id, kind, incident_date, description, amount, payroll_month, status, objection_text,
                                                        objected_at, decision_note, created_at
                                                 FROM deduction_notices WHERE employee_id = :e AND org_id = :o ORDER BY created_at DESC LIMIT 30"""),
                                       {"e": emp_id, "o": org_id}).mappings()]
    c.execute(text("UPDATE deduction_notices SET seen_at = now() WHERE employee_id = :e AND org_id = :o AND seen_at IS NULL"), {"e": emp_id, "o": org_id})
    return {"balance": balance(c, org_id, emp, y, pols),
            "policies": [{"leave_type": t, "label": hr.LEAVE_LABEL[t], "pay_mode": p["pay_mode"], "is_paid": p["pay_mode"] != "UNPAID", "from_balance": p["from_balance"],
                          "max_days_per_request": p["max_days_per_request"], "yearly_cap": p["yearly_cap"], "min_notice_days": p["min_notice_days"],
                          "used": used_days(c, emp_id, y, (t,))}
                         for t, p in pols.items() if p["is_active"]],
            "leaves": leaves, "notices": notices, "objection_days": s["objection_days"], "count_workdays_only": s["count_workdays_only"]}
