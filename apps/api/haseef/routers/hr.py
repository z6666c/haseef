"""الموارد البشرية (ضمن إضافة ATTENDANCE): الإجازات الثلاث، المباشرة، أرصدة الإجازة، وإشعارات الخصم.

صفحة الموظف العامة (برابطه الشخصي نفسه للحضور) تعرض رصيده وطلباته وإشعاراته، ويرفع منها الإجازة والمباشرة والاعتراض.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from ..db import platform_tx
from ..deps import Tenant, get_tenant
from ..domain import hr
from ..domain import penalties as pen
from ..services import hr_service as svc
from .attendance import MANAGERS, RIYADH, _need, _person
from .compliance import _audit
from .governance import file_response

router = APIRouter(tags=["hr"])
LeaveType = Literal["ANNUAL", "REGULAR", "EMERGENCY", "SICK"]
Kind = Literal["LATE", "ABSENCE", "LATE_RETURN", "VIOLATION", "OTHER"]


def _month(m: str) -> date:
    try:
        d = date.fromisoformat(f"{m}-01")
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "صيغة الشهر YYYY-MM")
    return d


# ================================================================ لوحة الموارد البشرية
@router.get("/hr/overview")
def overview(t: Tenant = Depends(get_tenant)):
    access = {k: svc._f(v) for k, v in _need(t, manage=False).items()}
    c, o = t.conn, t.org_id
    pols = svc.policies(c, o)
    s = svc.hr_settings(c, o)
    today = svc.today()
    emps = [dict(r) for r in c.execute(text("""SELECT id, full_name, job_title, start_date, mobile, basic_wage, housing_allowance FROM org_employees
                                              WHERE is_active ORDER BY full_name""")).mappings()]
    people = []
    for e in emps:
        b = svc.balance(c, o, e, today.year, pols)
        people.append({"id": e["id"], "full_name": e["full_name"], "job_title": e["job_title"], "mobile": e["mobile"], **b})
    leaves = [svc.row(r) for r in c.execute(text("""
        SELECT l.id, l.employee_id, e.full_name, l.leave_type, l.start_date, l.end_date, l.days, l.reason, l.medical_ref, l.is_paid, l.attachment_name, (l.attachment_key IS NOT NULL) AS has_attachment, l.status, l.source,
               l.decision_note, l.decided_at, l.return_date, l.return_submitted_at, l.return_confirmed_at, l.created_at
        FROM leave_requests l JOIN org_employees e ON e.id = l.employee_id
        WHERE l.status = 'PENDING' OR l.start_date >= :since OR (l.status = 'APPROVED' AND l.return_confirmed_at IS NULL)
        ORDER BY (l.status = 'PENDING') DESC, l.start_date DESC LIMIT 200"""), {"since": today - timedelta(days=120)}).mappings()]
    wd, hol, _ = svc.work_calendar(c, o)
    svc.annotate_sick(leaves)
    for l in leaves:
        sd, ed = date.fromisoformat(l["start_date"]), date.fromisoformat(l["end_date"])
        l["label"] = hr.LEAVE_LABEL[l["leave_type"]]
        l["on_leave_now"] = l["status"] == "APPROVED" and sd <= today <= ed
        l["awaiting_return"] = l["status"] == "APPROVED" and ed < today and not l["return_confirmed_at"]
        l["late_return_days"] = hr.late_return_days(ed, date.fromisoformat(l["return_date"]) if l["return_date"] else today,
                                                    work_days=wd, holidays=hol) if l["status"] == "APPROVED" and ed < today else 0
    return {"access": access, "can_manage": t.role in MANAGERS,
            "settings": {k: v for k, v in svc.row(s).items() if k != "org_id"},
            "policies": [{**{k: v for k, v in p.items() if k != "org_id"}, "label": hr.LEAVE_LABEL[k]} for k, p in pols.items()],
            "people": [svc.row(p) for p in people], "leaves": leaves,
            "stats": {"pending": sum(l["status"] == "PENDING" for l in leaves), "on_leave": sum(l["on_leave_now"] for l in leaves),
                      "awaiting_return": sum(l["awaiting_return"] for l in leaves)}}


class HrSettingsIn(BaseModel):
    count_workdays_only: bool = True
    objection_days: int = Field(15, ge=1, le=60)
    notify_employees: bool = True
    deduction_method: Literal["REGULATION", "DURATION"] = "REGULATION"
    wage_base: Literal["BASIC", "BASIC_HOUSING", "TOTAL"] = "TOTAL"
    late_repeat_days: int = Field(180, ge=30, le=365)


@router.put("/hr/settings")
def put_settings(body: HrSettingsIn, t: Tenant = Depends(get_tenant)):
    _need(t)
    svc.hr_settings(t.conn, t.org_id)
    t.conn.execute(text("""UPDATE hr_settings SET count_workdays_only = :count_workdays_only, objection_days = :objection_days,
                           notify_employees = :notify_employees, deduction_method = :deduction_method, wage_base = :wage_base,
                           late_repeat_days = :late_repeat_days, updated_at = now() WHERE org_id = :o"""), {**body.model_dump(), "o": t.org_id})
    _audit(t.conn, t, "UPDATE", "hr_settings", None, body.model_dump())
    return {"ok": True}


class PolicyIn(BaseModel):
    pay_mode: Literal["PAID", "UNPAID", "CHOICE"]
    from_balance: bool
    max_days_per_request: int | None = Field(None, ge=1, le=120)
    yearly_cap: int | None = Field(None, ge=1, le=365)
    min_notice_days: int = Field(0, ge=0, le=90)
    is_active: bool = True


@router.put("/hr/policies/{leave_type}")
def put_policy(leave_type: LeaveType, body: PolicyIn, t: Tenant = Depends(get_tenant)):
    _need(t)
    svc.policies(t.conn, t.org_id)
    if leave_type in ("ANNUAL", "SICK") and body.pay_mode != "PAID":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "الإجازة السنوية والمرضية مدفوعة نظاماً (المرضية بشرائح المادة 117)")
    t.conn.execute(text("""UPDATE hr_leave_policies SET pay_mode = :pay_mode, is_paid = :paid, from_balance = :from_balance, max_days_per_request = :max_days_per_request,
                           yearly_cap = :yearly_cap, min_notice_days = :min_notice_days, is_active = :is_active WHERE org_id = :o AND leave_type = :t"""),
                   {**body.model_dump(), "paid": body.pay_mode != "UNPAID", "o": t.org_id, "t": leave_type})
    _audit(t.conn, t, "UPDATE", "leave_policy", None, {"type": leave_type, **body.model_dump()})
    return {"ok": True}


class AttachmentIn(BaseModel):
    file_name: str = Field("", max_length=200)
    file_base64: str = Field(min_length=8, max_length=8_500_000)   # ~6 ميجابايت بعد فك الترميز


class LeaveIn(BaseModel):
    employee_id: UUID
    leave_type: LeaveType
    start_date: date
    end_date: date
    reason: str | None = Field(None, max_length=500)
    medical_ref: str | None = Field(None, max_length=60)
    attachment: AttachmentIn | None = None
    is_paid: bool | None = None
    approve: bool = True


@router.post("/hr/leaves", status_code=201)
def add_leave(body: LeaveIn, t: Tenant = Depends(get_tenant)):
    _need(t)
    r = svc.create_leave(t.conn, t.org_id, body.employee_id, leave_type=body.leave_type, start=body.start_date, end=body.end_date,
                         reason=body.reason, source="HR", by_hr=True, user_id=t.principal.user_id, approve=body.approve, medical_ref=body.medical_ref,
                         attachment=body.attachment.model_dump() if body.attachment else None, is_paid=body.is_paid)
    _audit(t.conn, t, "CREATE", "leave_request", r["id"], body.model_dump(exclude={"attachment"}))
    return r


class DecideIn(BaseModel):
    approve: bool
    is_paid: bool | None = None
    note: str | None = Field(None, max_length=500)


@router.post("/hr/leaves/{leave_id}/decide")
def decide(leave_id: UUID, body: DecideIn, t: Tenant = Depends(get_tenant)):
    _need(t)
    r = svc.decide_leave(t.conn, t.org_id, leave_id, approve=body.approve, note=body.note, user_id=t.principal.user_id, is_paid=body.is_paid)
    _audit(t.conn, t, "APPROVE" if body.approve else "REJECT", "leave_request", leave_id, body.model_dump())
    return r


@router.post("/hr/leaves/{leave_id}/cancel")
def hr_cancel(leave_id: UUID, t: Tenant = Depends(get_tenant)):
    _need(t)
    if not t.conn.execute(text("UPDATE leave_requests SET status = 'CANCELLED' WHERE id = :i AND status IN ('PENDING','APPROVED') AND return_date IS NULL"),
                          {"i": leave_id}).rowcount:
        raise HTTPException(status.HTTP_409_CONFLICT, "لا يمكن إلغاء هذا الطلب")
    _audit(t.conn, t, "CANCEL", "leave_request", leave_id)
    return {"ok": True}


@router.get("/hr/leaves/{leave_id}/attachment")
def leave_attachment(leave_id: UUID, t: Tenant = Depends(get_tenant)):
    """التقرير الطبي بيانات صحية حساسة: لمدير المنشأة ومسؤول الامتثال فقط، ويُسجَّل كل اطلاع."""
    _need(t)
    r = t.conn.execute(text("SELECT attachment_key, attachment_name, attachment_mime FROM leave_requests WHERE id = :i"),
                       {"i": leave_id}).mappings().one_or_none()
    if not r or not r["attachment_key"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "لا يوجد مرفق")
    _audit(t.conn, t, "VIEW_ATTACHMENT", "leave_request", leave_id)
    return file_response(r["attachment_key"], r["attachment_name"], r["attachment_mime"])


class ReturnIn(BaseModel):
    return_date: date


@router.post("/hr/leaves/{leave_id}/return")
def hr_return(leave_id: UUID, body: ReturnIn, t: Tenant = Depends(get_tenant)):
    _need(t)
    emp = t.conn.execute(text("SELECT employee_id FROM leave_requests WHERE id = :i"), {"i": leave_id}).scalar_one_or_none()
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الطلب غير موجود")
    r = svc.submit_return(t.conn, t.org_id, emp, leave_id, body.return_date, by_hr=True, user_id=t.principal.user_id)
    _audit(t.conn, t, "CONFIRM_RETURN", "leave_request", leave_id, body.model_dump())
    return r


class AdjustIn(BaseModel):
    days: float = Field(ge=-365, le=365)
    note: str = Field(min_length=2, max_length=300)
    year: int | None = Field(None, ge=2000, le=2100)


@router.post("/hr/employees/{employee_id}/adjust", status_code=201)
def adjust(employee_id: UUID, body: AdjustIn, t: Tenant = Depends(get_tenant)):
    _need(t)
    svc.employee(t.conn, t.org_id, employee_id)
    if body.days == 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "أدخل عدد أيام غير صفري")
    t.conn.execute(text("""INSERT INTO leave_adjustments (org_id, employee_id, year, days, note, created_by) VALUES (:o, :e, :y, :d, :n, :u)"""),
                   {"o": t.org_id, "e": employee_id, "y": body.year or svc.today().year, "d": body.days, "n": body.note, "u": t.principal.user_id})
    _audit(t.conn, t, "ADJUST", "leave_balance", employee_id, body.model_dump())
    return {"ok": True}


# ---------------------------------------------------------------- الخصومات والجزاءات
NOTICE_COLS = """n.id, n.employee_id, e.full_name, n.kind, n.nature, n.bracket, n.occurrence, n.disrupted, n.incident_date, n.description,
               n.amount, n.payroll_month, n.status, n.seen_at, n.objection_text, n.objected_at, n.decision_note, n.decided_at,
               n.created_at, n.leave_request_id"""


@router.get("/hr/deductions")
def deductions(month: str, t: Tenant = Depends(get_tenant)):
    _need(t, manage=False)
    c, o = t.conn, t.org_id
    m = _month(month)
    nxt = date(m.year + (m.month == 12), m.month % 12 + 1, 1)
    today = svc.today()
    hs = svc.hr_settings(c, o)
    notices = [svc.row(r) for r in c.execute(text(f"""
        SELECT {NOTICE_COLS} FROM deduction_notices n JOIN org_employees e ON e.id = n.employee_id
        WHERE n.payroll_month = :m ORDER BY n.created_at DESC"""), {"m": m}).mappings()]
    for n in notices:
        n["kind_label"] = hr.KIND_LABEL[n["kind"]]
        n["nature_label"] = hr.NATURE_LABEL[n["nature"]]
        n["bracket_label"] = pen.BRACKET_LABEL.get(n["bracket"] or "", None)
    emps = {r["id"]: dict(r) for r in c.execute(text("""SELECT id, full_name, start_date, basic_wage, housing_allowance, other_allowances
                                                       FROM org_employees WHERE is_active""")).mappings()}
    wd, hol, work_min = svc.work_calendar(c, o)
    suggestions = _suggest(c, m, nxt, today, emps, notices, wd, hol, work_min, hs)
    summary = []
    for eid, e in emps.items():
        live = [n for n in notices if str(n["employee_id"]) == str(eid) and n["status"] in ("ISSUED", "OBJECTED", "CONFIRMED")]
        if not live:
            continue
        dw = svc.emp_daily_wage(e, hs)
        summary.append({"employee_id": eid, "full_name": e["full_name"],
                        "fines": round(sum(n["amount"] for n in live if n["nature"] == "PENALTY"), 2),
                        "wage": round(sum(n["amount"] for n in live if n["nature"] == "WAGE"), 2),
                        "warnings": sum(1 for n in live if n["nature"] == "WARNING"),
                        "total": round(sum(n["amount"] for n in live), 2),
                        "confirmed": round(sum(n["amount"] for n in live if n["status"] == "CONFIRMED"), 2),
                        "fine_cap": round(dw * 5, 2),
                        "half_wage": round(hr.monthly_wage(e["basic_wage"], e["housing_allowance"], e["other_allowances"]) / 2, 2)})
    # الإجازات المعتمدة بدون أجر: أيامها الواقعة في هذا الشهر لا يُستحق عنها أجر (ليست جزاءً ولا تحتاج إشعار خصم)
    unpaid = []
    for l in c.execute(text("""SELECT l.id, l.employee_id, l.leave_type, l.start_date, l.end_date FROM leave_requests l
                               WHERE l.status = 'APPROVED' AND NOT l.is_paid AND l.start_date < :n AND l.end_date >= :m ORDER BY l.start_date"""),
                       {"m": m, "n": nxt}).mappings():
        e = emps.get(l["employee_id"])
        if not e:
            continue
        a, b = max(l["start_date"], m), min(l["end_date"], nxt - timedelta(days=1))
        days = hr.count_days(a, b, work_days=wd, holidays=hol, workdays_only=hs["count_workdays_only"] and l["leave_type"] != "SICK")
        if days:
            unpaid.append({"leave_id": l["id"], "employee_id": l["employee_id"], "full_name": e["full_name"], "leave_type": l["leave_type"],
                           "label": hr.LEAVE_LABEL[l["leave_type"]], "from_date": a, "to_date": b, "days": days,
                           "amount": round(days * svc.emp_daily_wage(e, hs), 2)})
    return {"month": month, "notices": notices, "suggestions": suggestions, "summary": [svc.row(x) for x in summary],
            "unpaid_leaves": [svc.row(u) for u in unpaid], "objection_days": hs["objection_days"],
            "method": hs["deduction_method"], "wage_base": hs["wage_base"], "late_repeat_days": hs["late_repeat_days"]}


def _penalty(c, e: dict, bracket: str, incident: date, hs: dict, pending: dict, dw: float) -> dict | None:
    """الجزاء المقترح وفق جدول اللائحة، مع رقم التكرار: ما صدر سابقاً + ما يسبقه من اقتراحات هذا الشهر."""
    if hs["deduction_method"] != "REGULATION":
        return None
    key = (str(e["id"]), bracket)
    occ = svc.prior_occurrences(c, e, bracket, incident, hs) + pending.get(key, 0) + 1
    pending[key] = pending.get(key, 0) + 1
    p = pen.suggest(bracket, occ, dw)
    if bracket in pen.LATE:
        alt = pen.suggest(bracket, occ, dw, disrupted=True)
        p["alt_disrupted"] = {k: alt[k] for k in ("nature", "label", "amount")}
    return p


def _suggest(c, m: date, nxt: date, today: date, emps: dict, notices: list[dict], wd, hol, work_min, hs: dict) -> list[dict]:
    """اقتراحات من سجل الحضور والمباشرة: حسم أجر المدة + الجزاء المتدرج (حسب طريقة المنشأة). لا يصدر شيء دون قرار الموارد البشرية."""
    have = {(str(n["employee_id"]), n["kind"], n["incident_date"]) for n in notices if n["status"] != "CANCELLED"}
    have_leave = {str(n["leave_request_id"]) for n in notices if n["leave_request_id"] and n["status"] != "CANCELLED"}
    grace = c.execute(text("SELECT grace_minutes FROM attendance_settings LIMIT 1")).scalar_one_or_none() or 0
    events: list[dict] = []
    start = datetime.combine(m, time(0), RIYADH)
    end = datetime.combine(min(nxt, today + timedelta(days=1)), time(0), RIYADH)
    # 1) التأخر: أجر دقائق ما بعد السماحية، والجزاء بشريحة مدة التأخر من بداية الدوام
    for r in c.execute(text("""SELECT employee_id, (at AT TIME ZONE 'Asia/Riyadh')::date AS d, max(late_minutes) AS late
                               FROM attendance_records WHERE kind = 'IN' AND status = 'ACCEPTED' AND late_minutes > 0 AND at >= :s AND at < :e
                               GROUP BY employee_id, d"""), {"s": start, "e": end}).mappings():
        e = emps.get(r["employee_id"])
        if not e or (str(r["employee_id"]), "LATE", r["d"].isoformat()) in have:
            continue
        events.append({"e": e, "kind": "LATE", "d": r["d"], "late": int(r["late"]), "from_start": int(r["late"]) + int(grace)})
    # 2) الغياب: لمن رُبط بالحضور، من تاريخ ربطه، خارج الإجازات والعطل؛ تُجمع الأيام المتصلة في واقعة واحدة
    linked = {r["employee_id"]: (r["created_at"].astimezone(RIYADH).date()) for r in c.execute(text("SELECT employee_id, created_at FROM attendance_people")).mappings()}
    present = {(r[0], r[1]) for r in c.execute(text("""SELECT DISTINCT employee_id, (at AT TIME ZONE 'Asia/Riyadh')::date FROM attendance_records
                                                     WHERE kind = 'IN' AND status = 'ACCEPTED' AND at >= :s AND at < :e"""), {"s": start, "e": end})}
    leaves = [dict(r) for r in c.execute(text("""SELECT employee_id, start_date, end_date FROM leave_requests WHERE status = 'APPROVED'
                                                AND start_date < :n AND end_date >= :m"""), {"m": m, "n": nxt}).mappings()]
    for eid, since in linked.items():
        e = emps.get(eid)
        if not e:
            continue
        run: list[date] = []
        d = m
        while d <= min(nxt, today):
            work = hr.weekday0(d) in wd and d not in hol and d < min(nxt, today)
            absent = (work and d >= since and d >= e["start_date"] and (eid, d) not in present
                      and not any(l["employee_id"] == eid and l["start_date"] <= d <= l["end_date"] for l in leaves))
            if absent:
                run.append(d)
            elif work or d >= min(nxt, today):          # يوم عمل حضره (أو نهاية الفترة) يقطع التتابع؛ العطل لا تقطعه
                if run and (str(eid), "ABSENCE", run[0].isoformat()) not in have:
                    events.append({"e": e, "kind": "ABSENCE", "d": run[0], "to": run[-1], "days": len(run)})
                run = []
            d += timedelta(days=1)
    # 3) التأخر عن المباشرة بعد الإجازة: يُعامل معاملة الغياب
    for l in c.execute(text("""SELECT id, employee_id, leave_type, end_date, return_date FROM leave_requests WHERE status = 'APPROVED'
                               AND return_date IS NOT NULL AND return_date >= :m AND return_date < :n"""), {"m": m, "n": nxt}).mappings():
        e = emps.get(l["employee_id"])
        if not e or str(l["id"]) in have_leave:
            continue
        late = hr.late_return_days(l["end_date"], l["return_date"], work_days=wd, holidays=hol)
        if late:
            events.append({"e": e, "kind": "LATE_RETURN", "d": l["return_date"], "days": late, "leave": l})
    events.sort(key=lambda x: (x["d"], x["e"]["full_name"]))
    pending: dict = {}
    out = []
    for ev in events:
        e = ev["e"]
        dw = svc.emp_daily_wage(e, hs)
        g = {"employee_id": e["id"], "full_name": e["full_name"], "kind": ev["kind"], "kind_label": hr.KIND_LABEL[ev["kind"]],
             "incident_date": ev["d"], "daily_wage": dw, "leave_request_id": None, "notes": []}
        if ev["kind"] == "LATE":
            g["description"] = f"تأخر {ev['from_start']} دقيقة عن بداية الدوام يوم {ev['d']:%Y-%m-%d}"
            amt = hr.late_amount(ev["late"], dw, work_min)
            g["wage"] = {"amount": amt, "label": f"أجر {ev['late']} دقيقة بعد السماحية"} if amt > 0 else None
            bracket = pen.late_bracket(ev["from_start"])
        else:
            days = ev["days"]
            if ev["kind"] == "ABSENCE":
                g["description"] = (f"غياب يوم {ev['d']:%Y-%m-%d} دون إجازة أو تسجيل حضور" if days == 1
                                    else f"غياب {days} أيام عمل متصلة من {ev['d']:%Y-%m-%d} إلى {ev['to']:%Y-%m-%d} دون إجازة أو تسجيل حضور")
            else:
                l = ev["leave"]
                g["leave_request_id"] = l["id"]
                g["description"] = f"تأخر {days} يوم عمل عن المباشرة بعد الإجازة ال{hr.LEAVE_LABEL[l['leave_type']]} (انتهت {l['end_date']:%Y-%m-%d})"
            g["wage"] = {"amount": round(days * dw, 2), "label": f"أجر {days} {'يوم' if days == 1 else 'أيام'} غياب"}
            bracket = pen.absence_bracket(days)
            if days >= 10:
                g["notes"].append("بلغ الغياب المتصل 10 أيام: يلزم إنذار كتابي قبل أي فصل وفق المادة 80 عند تجاوز 15 يوماً.")
        p = _penalty(c, e, bracket, ev["d"], hs, pending, dw) if bracket else None
        if p and p["nature"] in ("PENALTY", "WARNING") and (today - ev["d"]).days > 30:
            g["notes"].append("مضى أكثر من 30 يوماً على الواقعة: لا يجوز توقيع الجزاء، ويبقى حسم أجر المدة.")
            p = None
        g["penalty"] = p
        out.append(g)
    return [svc.row(x) for x in out]


class NoticeIn(BaseModel):
    employee_id: UUID
    kind: Kind
    nature: Literal["WAGE", "PENALTY", "WARNING"] | None = None
    bracket: str | None = Field(None, max_length=12)
    occurrence: int | None = Field(None, ge=1, le=99)
    disrupted: bool = False
    incident_date: date
    description: str = Field(min_length=3, max_length=1000)
    amount: float = Field(ge=0, le=1000000)
    payroll_month: str = Field(pattern=r"^\d{4}-\d{2}$")
    leave_request_id: UUID | None = None


def _issue(t: Tenant, body: NoticeIn, notify_employee: bool = True) -> dict:
    if body.bracket and body.bracket not in pen.BRACKET_LABEL:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "شريحة غير معروفة")
    r = svc.create_notice(t.conn, t.org_id, body.employee_id, kind=body.kind, incident=body.incident_date, description=body.description,
                          amount=round(body.amount, 2), payroll_month=_month(body.payroll_month), user_id=t.principal.user_id,
                          leave_request_id=body.leave_request_id, nature=body.nature, bracket=body.bracket, occurrence=body.occurrence,
                          disrupted=body.disrupted, notify_employee=notify_employee)
    _audit(t.conn, t, "CREATE", "deduction_notice", r["id"], body.model_dump())
    return r


@router.post("/hr/deductions", status_code=201)
def add_notice(body: NoticeIn, t: Tenant = Depends(get_tenant)):
    _need(t)
    return _issue(t, body)


class NoticeBatchIn(BaseModel):
    items: list[NoticeIn] = Field(min_length=1, max_length=2)


@router.post("/hr/deductions/batch", status_code=201)
def add_notices(body: NoticeBatchIn, t: Tenant = Depends(get_tenant)):
    """إصدار واقعة واحدة بإشعارين (حسم أجر المدة + الجزاء أو الإنذار) معاً: كلاهما أو لا شيء، وإشعار واحد للموظف."""
    _need(t)
    if len({(str(i.employee_id), i.incident_date, i.kind) for i in body.items}) != 1:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "عناصر الدفعة يجب أن تكون لواقعة واحدة")
    ids = [_issue(t, i, notify_employee=False)["id"] for i in body.items]
    first = body.items[0]
    parts = []
    for i in body.items:
        nat = i.nature or hr.nature_of(i.kind)
        parts.append("إنذار كتابي" if nat == "WARNING" else f"{hr.NATURE_LABEL[nat]} {i.amount:.2f} ريال")
    s = svc.hr_settings(t.conn, t.org_id)
    svc.notify(t.conn, t.org_id, first.employee_id, f"صدر بحقك عن واقعة {first.incident_date:%Y-%m-%d} ({hr.KIND_LABEL[first.kind]}): "
               f"{' + '.join(parts)}. يمكنك الاطلاع والاعتراض خلال {s['objection_days']} يوماً من رابطك الشخصي أو بكتابة «إشعاراتي» للمساعد.")
    return {"ids": ids}


class NoticeDecideIn(BaseModel):
    confirm: bool
    note: str | None = Field(None, max_length=500)


@router.post("/hr/deductions/{notice_id}/decide")
def decide_notice(notice_id: UUID, body: NoticeDecideIn, t: Tenant = Depends(get_tenant)):
    _need(t)
    svc.decide_notice(t.conn, t.org_id, notice_id, confirm=body.confirm, note=body.note, user_id=t.principal.user_id)
    _audit(t.conn, t, "CONFIRM" if body.confirm else "CANCEL", "deduction_notice", notice_id, body.model_dump())
    return {"ok": True}


# ================================================================ صفحة الموظف
@router.get("/public/attendance/{token}/hr")
def person_hr(token: str):
    with platform_tx() as c:
        p = _person(c, token)
        return svc.employee_view(c, p["org_id"], p["employee_id"])


class PersonLeaveIn(BaseModel):
    leave_type: LeaveType
    start_date: date
    end_date: date
    reason: str | None = Field(None, max_length=500)
    medical_ref: str | None = Field(None, max_length=60)
    attachment: AttachmentIn | None = None
    is_paid: bool | None = None


@router.post("/public/attendance/{token}/leaves", status_code=201)
def person_leave(token: str, body: PersonLeaveIn):
    with platform_tx() as c:
        p = _person(c, token)
        n = c.execute(text("SELECT count(*) FROM leave_requests WHERE employee_id = :e AND created_at > now() - interval '1 day'"),
                      {"e": p["employee_id"]}).scalar_one()
        if n >= 10:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "طلبات كثيرة اليوم")
        return svc.create_leave(c, p["org_id"], p["employee_id"], leave_type=body.leave_type, start=body.start_date, end=body.end_date,
                                reason=body.reason, source="LINK", by_hr=False, medical_ref=body.medical_ref,
                                attachment=body.attachment.model_dump() if body.attachment else None, is_paid=body.is_paid)


@router.post("/public/attendance/{token}/leaves/{leave_id}/attachment")
def person_attach(token: str, leave_id: UUID, body: AttachmentIn):
    with platform_tx() as c:
        p = _person(c, token)
        svc.attach(c, p["org_id"], p["employee_id"], leave_id, body.model_dump())
    return {"ok": True}


@router.post("/public/attendance/{token}/leaves/{leave_id}/cancel")
def person_cancel(token: str, leave_id: UUID):
    with platform_tx() as c:
        p = _person(c, token)
        if not c.execute(text("UPDATE leave_requests SET status = 'CANCELLED' WHERE id = :i AND employee_id = :e AND status = 'PENDING'"),
                         {"i": leave_id, "e": p["employee_id"]}).rowcount:
            raise HTTPException(status.HTTP_409_CONFLICT, "يمكن إلغاء الطلب قبل البت فيه فقط")
    return {"ok": True}


@router.post("/public/attendance/{token}/leaves/{leave_id}/return")
def person_return(token: str, leave_id: UUID, body: ReturnIn):
    with platform_tx() as c:
        p = _person(c, token)
        return svc.submit_return(c, p["org_id"], p["employee_id"], leave_id, body.return_date, by_hr=False)


class ObjectIn(BaseModel):
    objection: str = Field(min_length=5, max_length=1000)


@router.post("/public/attendance/{token}/notices/{notice_id}/object")
def person_object(token: str, notice_id: UUID, body: ObjectIn):
    with platform_tx() as c:
        p = _person(c, token)
        svc.object_notice(c, p["org_id"], p["employee_id"], notice_id, body.objection)
    return {"ok": True}
