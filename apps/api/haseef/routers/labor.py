"""العمل والموظفين: تقويم الالتزامات الشهرية (التأمينات، حماية الأجور، الرواتب) لكل الباقات،
وسجل الموظفين وحاسبة التأمينات ومؤشرات قوى (ميزة LABOR_HR، مفعّلة في كل الباقات منذ 0016).

حصيف لا يتصل بحسابات المنشأة في التأمينات أو قوى أو مُدد: العميل يُدخل البيانات ويؤكد الإنجاز برقم مرجعي.
الأجور لا يراها إلا مدير المنشأة ومسؤول الامتثال.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text

from ..deps import Tenant, get_tenant
from ..domain.labor import TASK_LABEL, contribution, gosi_late_penalty, month_start, pick_rate, qiwa_indicators, rate_system
from ..services import governance_service as gs
from ..services import labor_service
from ..services.entitlements import has_feature
from .compliance import _audit

router = APIRouter(prefix="/labor", tags=["labor"])

HR_MANAGERS = ("ORG_ADMIN", "COMPLIANCE_OFFICER")
FEATURE = "LABOR_HR"
EMP_COLS = """id, full_name, nationality, job_title, start_date, gosi_system, basic_wage, housing_allowance, gosi_registered,
              qiwa_contract_documented, contract_end_date, probation_end_date, iqama_expiry, work_permit_expiry, is_active, left_on"""


def _num(v):
    return float(v) if isinstance(v, Decimal) else v


def _clean(row: dict) -> dict:
    return {k: _num(v) for k, v in row.items()}


def _months_back(d: date, n: int) -> date:
    m = d.year * 12 + d.month - 1 - n
    return date(m // 12, m % 12 + 1, 1)


def _feature(t: Tenant) -> None:
    if not has_feature(t.conn, t.org_id, FEATURE):
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED,
                            "سجل الموظفين وحاسبة التأمينات ومؤشرات قوى غير مفعّلة في باقتك")


def _employees(t: Tenant, active_only: bool = False) -> list[dict]:
    rows = t.conn.execute(text(f"""SELECT {EMP_COLS} FROM org_employees WHERE (is_active OR NOT :active_only)
                                   ORDER BY is_active DESC, full_name"""), {"active_only": active_only}).mappings()
    show_wages = t.role in HR_MANAGERS
    return [_clean({**r, **({} if show_wages else {"basic_wage": None, "housing_allowance": None})}) for r in rows]


@router.get("/overview")
def overview(t: Tenant = Depends(get_tenant)):
    c = t.conn
    today = gs.riyadh_today()
    labor_service.ensure_tasks(c, t.org_id, today)
    prof = c.execute(text("SELECT salary_day, nitaqat_band, nitaqat_checked_on, gosi_employer_no FROM labor_profiles")
                     ).mappings().one_or_none()
    tasks = [_clean(dict(r)) for r in c.execute(text("""
        SELECT t.id, t.period, t.kind, t.due_date, t.amount, t.done_at, t.reference, u.full_name AS done_by_name
        FROM labor_tasks t LEFT JOIN users u ON u.id = t.done_by
        WHERE t.done_at IS NULL OR t.period >= :from
        ORDER BY t.period DESC, t.due_date"""), {"from": _months_back(today, 3)}).mappings()]
    for x in tasks:
        x["label"] = TASK_LABEL[x["kind"]]
        x["days_left"] = (x["due_date"] - today).days
        x["overdue"] = x["done_at"] is None and x["days_left"] < 0
        if x["overdue"] and x["kind"] == "GOSI_PAYMENT" and x["amount"]:
            x["penalty_estimate"] = float(gosi_late_penalty(x["amount"], x["due_date"], today))
    hr = has_feature(c, t.org_id, FEATURE)
    out = {"enabled": prof is not None, "profile": dict(prof) if prof else None, "tasks": tasks, "hr": hr,
           "can_manage": t.role in HR_MANAGERS, "today": today}
    if hr:
        emps = _employees(t, active_only=True)
        out["indicators"] = qiwa_indicators(emps)
        horizon = 90
        docs = []
        for e in emps:
            for kind, label, d in (("IQAMA", "انتهاء الإقامة", e["iqama_expiry"]), ("WORK_PERMIT", "انتهاء رخصة العمل", e["work_permit_expiry"]),
                                   ("CONTRACT_END", "انتهاء عقد العمل", e["contract_end_date"]),
                                   ("PROBATION_END", "انتهاء فترة التجربة", e["probation_end_date"])):
                if d and (d - today).days <= horizon:
                    docs.append({"employee_id": e["id"], "full_name": e["full_name"], "kind": kind, "label": label,
                                 "due_date": d, "days_left": (d - today).days})
        out["documents"] = sorted(docs, key=lambda x: x["due_date"])
        if t.role in HR_MANAGERS:
            g = labor_service.gosi_for_month(c, t.org_id, month_start(today))
            out["gosi_month"] = {"period": g["period"], "employee_total": _num(g["employee_total"]),
                                 "employer_total": _num(g["employer_total"]), "total": _num(g["total"])}
    return out


class ProfileIn(BaseModel):
    salary_day: int = Field(27, ge=1, le=28)
    nitaqat_band: Literal["PLATINUM", "HIGH_GREEN", "MID_GREEN", "LOW_GREEN", "YELLOW", "RED"] | None = None
    nitaqat_checked_on: date | None = None
    gosi_employer_no: str | None = Field(None, max_length=20)


@router.put("/profile")
def set_profile(body: ProfileIn, t: Tenant = Depends(get_tenant)):
    """أول حفظ يفعّل التقويم الشهري والتنبيهات. تغيير يوم الرواتب يعدّل مواعيد المهام غير المنجزة."""
    t.require(*HR_MANAGERS)
    t.conn.execute(text("""
        INSERT INTO labor_profiles (org_id, salary_day, nitaqat_band, nitaqat_checked_on, gosi_employer_no)
        VALUES (:o, :salary_day, :nitaqat_band, :nitaqat_checked_on, :gosi_employer_no)
        ON CONFLICT (org_id) DO UPDATE SET salary_day = EXCLUDED.salary_day, nitaqat_band = EXCLUDED.nitaqat_band,
            nitaqat_checked_on = EXCLUDED.nitaqat_checked_on, gosi_employer_no = EXCLUDED.gosi_employer_no, updated_at = now()"""),
        {**body.model_dump(), "o": t.org_id})
    t.conn.execute(text("""UPDATE labor_tasks SET due_date = (period + make_interval(days => :d - 1))::date
                           WHERE kind = 'SALARY_PAYMENT' AND done_at IS NULL"""), {"d": body.salary_day})
    _audit(t.conn, t, "UPSERT", "labor_profile", None, body.model_dump())
    labor_service.ensure_tasks(t.conn, t.org_id, gs.riyadh_today())
    return {"ok": True}


class TaskDoneIn(BaseModel):
    reference: str | None = Field(None, max_length=100)
    amount: float | None = Field(None, ge=0)


@router.post("/tasks/{task_id}/done")
def task_done(task_id: UUID, body: TaskDoneIn, t: Tenant = Depends(get_tenant)):
    t.require(*HR_MANAGERS)
    n = t.conn.execute(text("""UPDATE labor_tasks SET done_at = now(), done_by = :u, reference = :r, amount = COALESCE(:a, amount)
                               WHERE id = :id AND done_at IS NULL"""),
                       {"u": t.principal.user_id, "r": body.reference, "a": body.amount, "id": task_id}).rowcount
    if not n:
        raise HTTPException(status.HTTP_409_CONFLICT, "المهمة غير موجودة أو منجزة")
    _audit(t.conn, t, "DONE", "labor_task", task_id, body.model_dump())
    return {"ok": True}


@router.post("/tasks/{task_id}/reopen")
def task_reopen(task_id: UUID, t: Tenant = Depends(get_tenant)):
    t.require(*HR_MANAGERS)
    n = t.conn.execute(text("UPDATE labor_tasks SET done_at = NULL, done_by = NULL WHERE id = :id AND done_at IS NOT NULL"),
                       {"id": task_id}).rowcount
    if not n:
        raise HTTPException(status.HTTP_409_CONFLICT, "المهمة غير منجزة")
    _audit(t.conn, t, "REOPEN", "labor_task", task_id)
    return {"ok": True}


# ---------------------------------------------------------------- سجل الموظفين (LABOR_HR)
class EmployeeIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=150)
    nationality: Literal["SAUDI", "NON_SAUDI"]
    job_title: str | None = Field(None, max_length=120)
    start_date: date
    gosi_system: Literal["OLD", "NEW"] = "OLD"
    basic_wage: float = Field(ge=0, le=1_000_000)
    housing_allowance: float = Field(0, ge=0, le=1_000_000)
    gosi_registered: bool = False
    qiwa_contract_documented: bool = False
    contract_end_date: date | None = None
    probation_end_date: date | None = None
    iqama_expiry: date | None = None
    work_permit_expiry: date | None = None

    @model_validator(mode="after")
    def _saudi(self):
        if self.nationality == "SAUDI":
            self.iqama_expiry = self.work_permit_expiry = None
        return self


EMP_INS_COLS = ", ".join(EmployeeIn.model_fields)
EMP_INS_VALS = ", ".join(":" + k for k in EmployeeIn.model_fields)
EMP_SETS = ", ".join(f"{k} = :{k}" for k in EmployeeIn.model_fields)


@router.get("/employees")
def list_employees(t: Tenant = Depends(get_tenant)):
    _feature(t)
    return {"employees": _employees(t), "show_wages": t.role in HR_MANAGERS}


@router.post("/employees", status_code=201)
def create_employee(body: EmployeeIn, t: Tenant = Depends(get_tenant)):
    _feature(t)
    t.require(*HR_MANAGERS)
    new_id = t.conn.execute(text(f"INSERT INTO org_employees (org_id, {EMP_INS_COLS}) VALUES (:org, {EMP_INS_VALS}) RETURNING id"),
        {**body.model_dump(), "org": t.org_id}).scalar_one()
    _audit(t.conn, t, "CREATE", "employee", new_id, {"full_name": body.full_name})
    return {"id": new_id}


class BulkIn(BaseModel):
    employees: list[EmployeeIn] = Field(min_length=1, max_length=500)


@router.post("/employees/bulk", status_code=201)
def import_employees(body: BulkIn, t: Tenant = Depends(get_tenant)):
    """استيراد من ملف CSV/Excel (تحلّله الواجهة). لا يحذف الموجود."""
    _feature(t)
    t.require(*HR_MANAGERS)
    for e in body.employees:
        t.conn.execute(text(f"INSERT INTO org_employees (org_id, {EMP_INS_COLS}) VALUES (:org, {EMP_INS_VALS})"),
                       {**e.model_dump(), "org": t.org_id})
    _audit(t.conn, t, "IMPORT", "employee", None, {"count": len(body.employees)})
    return {"imported": len(body.employees)}


@router.put("/employees/{emp_id}")
def update_employee(emp_id: UUID, body: EmployeeIn, t: Tenant = Depends(get_tenant)):
    _feature(t)
    t.require(*HR_MANAGERS)
    n = t.conn.execute(text(f"UPDATE org_employees SET {EMP_SETS}, updated_at = now() WHERE id = :id"), {**body.model_dump(), "id": emp_id}).rowcount
    if not n:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الموظف غير موجود")
    _audit(t.conn, t, "UPDATE", "employee", emp_id, {"full_name": body.full_name})
    return {"ok": True}


class LeaveIn(BaseModel):
    left_on: date


@router.post("/employees/{emp_id}/leave")
def employee_left(emp_id: UUID, body: LeaveIn, t: Tenant = Depends(get_tenant)):
    """إنهاء خدمة: يبقى في السجل للتاريخ، ويخرج من الحساب والتنبيهات."""
    _feature(t)
    t.require(*HR_MANAGERS)
    n = t.conn.execute(text("UPDATE org_employees SET is_active = false, left_on = :d, updated_at = now() WHERE id = :id AND is_active"),
                       {"d": body.left_on, "id": emp_id}).rowcount
    if not n:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الموظف غير موجود")
    _audit(t.conn, t, "LEAVE", "employee", emp_id, body.model_dump())
    return {"ok": True}


@router.get("/gosi")
def gosi_month(month: str | None = None, t: Tenant = Depends(get_tenant)):
    """تفصيل اشتراكات شهر (YYYY-MM) لكل موظف."""
    _feature(t)
    t.require(*HR_MANAGERS)
    try:
        period = date.fromisoformat(f"{month}-01") if month else month_start(gs.riyadh_today())
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "صيغة الشهر YYYY-MM")
    g = labor_service.gosi_for_month(t.conn, t.org_id, period)
    return {**{k: _num(v) for k, v in g.items() if k != "lines"}, "lines": [_clean(l) for l in g["lines"]]}


class CalcIn(BaseModel):
    nationality: Literal["SAUDI", "NON_SAUDI"]
    gosi_system: Literal["OLD", "NEW"] = "OLD"
    basic_wage: float = Field(ge=0)
    housing_allowance: float = Field(0, ge=0)
    on: date | None = None


@router.post("/calculator")
def calculator(body: CalcIn, t: Tenant = Depends(get_tenant)):
    _feature(t)
    on = body.on or gs.riyadh_today()
    rate = pick_rate(labor_service.load_rates(t.conn), rate_system(body.nationality, body.gosi_system), on)
    if rate is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "لا توجد نسبة سارية في هذا التاريخ")
    return {k: _num(v) for k, v in contribution(body.basic_wage, body.housing_allowance, rate).items()} | {"on": on}


@router.get("/rates")
def rates(t: Tenant = Depends(get_tenant)):
    return [_clean(dict(r)) for r in t.conn.execute(text("""SELECT system, effective_from, employee_annuity, employer_annuity,
        employee_saned, employer_saned, employer_hazards, min_base, max_base, note FROM gosi_rates ORDER BY system, effective_from""")).mappings()]

