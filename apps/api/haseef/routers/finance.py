"""المالية الداخلية لحصيف في غرفة العمليات: الوضع المالي، الفواتير، المصروفات، إقرار الضريبة، بيانات المنشأة.

الصلاحيات:
  * finance.view       — قراءة كل ما سبق.
  * expenses.manage    — تسجيل المصروفات وتعديلها، إلغاء فاتورة بإشعار دائن، تعديل بيانات حصيف الضريبية.
  * billing.manage     — عرض الفواتير (لمن يسجّل الدفعات).
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from ..deps import Admin, require_perm
from ..services import installments_service, invoicing

router = APIRouter(prefix="/admin/finance", tags=["finance"])

Category = Literal["HOSTING", "AI", "MESSAGING", "PAYMENT_FEES", "SALARIES", "LAWYER_FEES", "MARKETING",
                   "PROFESSIONAL", "GOVERNMENT", "SOFTWARE", "OFFICE", "OTHER"]
VIEW = ("finance.view",)


def _period(p: str) -> tuple[date, date]:
    import re
    if m := re.fullmatch(r"(\d{4})-(\d{2})", p):
        y, mo = int(m[1]), int(m[2])
        if not 1 <= mo <= 12:
            raise HTTPException(422, "شهر غير صحيح")
        return date(y, mo, 1), (date(y + 1, 1, 1) if mo == 12 else date(y, mo + 1, 1))
    if m := re.fullmatch(r"(\d{4})-Q([1-4])", p):
        y, q = int(m[1]), int(m[2])
        s = (q - 1) * 3 + 1
        return date(y, s, 1), (date(y + 1, 1, 1) if q == 4 else date(y, s + 3, 1))
    if m := re.fullmatch(r"(\d{4})", p):
        return date(int(m[1]), 1, 1), date(int(m[1]) + 1, 1, 1)
    raise HTTPException(422, "الفترة: 2026-10 أو 2026-Q4 أو 2026")


def _money(rows) -> list[dict]:
    return [{k: (float(v) if isinstance(v, Decimal) else v) for k, v in dict(r).items()} for r in rows]


# ---------------------------------------------------------------- الوضع المالي
@router.get("/summary")
def summary(period: str = Query(...), a: Admin = Depends(require_perm(*VIEW))):
    """قائمة الدخل للفترة (أساس الفواتير): الإيراد صافي الإشعارات الدائنة، والمصروفات، والضريبة، والنقد المحصّل."""
    start, end = _period(period)
    c, p = a.conn, {"s": start, "e": end}
    rev = _money(c.execute(text("""
        SELECT source,
               sum(CASE WHEN kind = 'INVOICE' THEN subtotal ELSE -subtotal END)   AS net,
               sum(CASE WHEN kind = 'INVOICE' THEN vat_amount ELSE -vat_amount END) AS vat,
               count(*) FILTER (WHERE kind = 'INVOICE')                          AS invoices,
               count(*) FILTER (WHERE kind = 'CREDIT_NOTE')                      AS credit_notes
        FROM invoices WHERE issued_at >= :s AND issued_at < :e GROUP BY source ORDER BY source"""), p).mappings())
    exp = _money(c.execute(text("""
        SELECT category, sum(net_amount) AS net, sum(vat_amount) AS vat, count(*) AS n
        FROM expenses WHERE spent_on >= :s AND spent_on < :e GROUP BY category ORDER BY sum(net_amount) DESC"""), p).mappings())
    monthly = _money(c.execute(text("""
        WITH r AS (SELECT date_trunc('month', issued_at AT TIME ZONE 'Asia/Riyadh')::date AS m,
                          sum(CASE WHEN kind = 'INVOICE' THEN subtotal ELSE -subtotal END) AS revenue
                   FROM invoices WHERE issued_at >= :s AND issued_at < :e GROUP BY 1),
             x AS (SELECT date_trunc('month', spent_on)::date AS m, sum(net_amount) AS expenses
                   FROM expenses WHERE spent_on >= :s AND spent_on < :e GROUP BY 1)
        SELECT COALESCE(r.m, x.m) AS month, COALESCE(revenue, 0) AS revenue, COALESCE(expenses, 0) AS expenses
        FROM r FULL JOIN x ON r.m = x.m ORDER BY 1"""), p).mappings())
    revenue = sum(r["net"] for r in rev)
    expenses = sum(e["net"] for e in exp)
    out_vat = sum(r["vat"] for r in rev)
    in_vat = sum(e["vat"] for e in exp)
    # مؤشرات حالية لا ترتبط بالفترة: الإيراد الشهري المتكرر والتجديدات المستحقة خلال 30 يوماً
    mrr = c.execute(text("""
        SELECT COALESCE(sum(CASE WHEN s.billing_cycle = 'YEARLY' THEN p.yearly_price_sar / 12.0 ELSE p.monthly_price_sar END), 0)
        FROM subscriptions s JOIN plans p ON p.tier = s.plan_tier WHERE s.billing_status = 'ACTIVE'""")).scalar_one()
    due = _money(c.execute(text("""
        SELECT o.id AS org_id, o.name, s.plan_tier, s.billing_cycle, s.ends_at,
               CASE WHEN s.billing_cycle = 'YEARLY' THEN p.yearly_price_sar ELSE p.monthly_price_sar END AS expected
        FROM subscriptions s JOIN organizations o ON o.id = s.org_id JOIN plans p ON p.tier = s.plan_tier
        WHERE s.billing_status IN ('ACTIVE','PAST_DUE','TRIAL') AND s.ends_at < now() + interval '30 days'
        ORDER BY s.ends_at""")).mappings())
    inst = _money(c.execute(text("""
        SELECT i.id, i.plan_id, i.seq, p.installments, i.due_date, i.amount_net, o.id AS org_id, o.name,
               (i.due_date < CAST(:today AS date)) AS overdue
        FROM plan_installments i JOIN payment_plans p ON p.id = i.plan_id JOIN organizations o ON o.id = p.org_id
        WHERE i.paid_at IS NULL AND p.status = 'ACTIVE' AND i.due_date < CAST(:today AS date) + 30
        ORDER BY i.due_date"""), {"today": installments_service.today_riyadh()}).mappings())
    return {"period": period, "from": start, "to": end,
            "revenue": {"total": revenue, "by_source": rev},
            "expenses": {"total": expenses, "by_category": exp},
            "net_profit": revenue - expenses, "margin": (revenue - expenses) / revenue if revenue else None,
            "vat": {"output": out_vat, "input": in_vat, "payable": out_vat - in_vat},
            "monthly": monthly, "mrr": float(mrr), "renewals_due": due,
            "renewals_expected": sum(d["expected"] for d in due),
            "installments_due": inst,
            "installments_overdue_total": sum(i["amount_net"] for i in inst if i["overdue"])}


# ---------------------------------------------------------------- الفواتير
@router.get("/invoices")
def invoices(period: str | None = None, q: str | None = None,
             a: Admin = Depends(require_perm("finance.view", "billing.manage"))):
    start, end = _period(period) if period else (date(2000, 1, 1), date(2100, 1, 1))
    rows = a.conn.execute(text("""
        SELECT i.id, i.number, i.kind, i.source, i.org_id, i.buyer_name, i.subtotal, i.vat_amount, i.total,
               i.issued_at, i.status, i.payment_reference, r.number AS related_number
        FROM invoices i LEFT JOIN invoices r ON r.id = i.related_invoice_id
        WHERE i.issued_at >= :s AND i.issued_at < :e
          AND (CAST(:q AS text) IS NULL OR i.number ILIKE '%' || :q || '%' OR i.buyer_name ILIKE '%' || :q || '%')
        ORDER BY i.issued_at DESC LIMIT 500"""), {"s": start, "e": end, "q": q or None}).mappings()
    return _money(rows)


@router.get("/invoices/{invoice_id}")
def invoice(invoice_id: UUID, a: Admin = Depends(require_perm("finance.view", "billing.manage"))):
    row = a.conn.execute(text("""
        SELECT i.*, r.number AS related_number, cn.number AS credit_note_number, cn.id AS credit_note_id
        FROM invoices i LEFT JOIN invoices r ON r.id = i.related_invoice_id
        LEFT JOIN invoices cn ON cn.related_invoice_id = i.id AND cn.kind = 'CREDIT_NOTE'
        WHERE i.id = :i"""), {"i": invoice_id}).mappings().one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الفاتورة غير موجودة")
    return _money([row])[0]


class VoidIn(BaseModel):
    reason: str = Field(min_length=5, max_length=500)


@router.post("/invoices/{invoice_id}/void")
def void_invoice(invoice_id: UUID, body: VoidIn, a: Admin = Depends(require_perm("expenses.manage"))):
    try:
        cn = invoicing.credit_note(a.conn, invoice_id=invoice_id, reason=body.reason, user_id=a.user_id)
    except LookupError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    except ValueError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    a.audit("ADMIN_INVOICE_VOID", "invoice", invoice_id, None, {"reason": body.reason, "credit_note": cn["number"]})
    return {"credit_note": {"id": cn["id"], "number": cn["number"]}}


# ---------------------------------------------------------------- المصروفات
class ExpenseIn(BaseModel):
    spent_on: date
    category: Category
    vendor: str = Field(min_length=2, max_length=150)
    description: str | None = Field(default=None, max_length=1000)
    net_amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    vat_amount: Decimal = Field(default=Decimal("0"), ge=0, max_digits=12, decimal_places=2)
    reference: str | None = Field(default=None, max_length=100)
    recurring: bool = False


@router.get("/expenses")
def expenses(period: str | None = None, category: Category | None = None, a: Admin = Depends(require_perm(*VIEW, "expenses.manage"))):
    start, end = _period(period) if period else (date(2000, 1, 1), date(2100, 1, 1))
    rows = a.conn.execute(text("""
        SELECT e.id, e.spent_on, e.category, e.vendor, e.description, e.net_amount, e.vat_amount, e.total, e.reference,
               e.recurring, e.created_at, u.full_name AS created_by_name
        FROM expenses e LEFT JOIN users u ON u.id = e.created_by
        WHERE e.spent_on >= :s AND e.spent_on < :e AND (CAST(:c AS text) IS NULL OR e.category = :c)
        ORDER BY e.spent_on DESC, e.created_at DESC LIMIT 1000"""), {"s": start, "e": end, "c": category}).mappings()
    return _money(rows)


def _check_vat(body: ExpenseIn) -> None:
    if body.vat_amount > body.net_amount * Decimal("0.15") + Decimal("0.05"):
        raise HTTPException(422, "ضريبة المدخلات أكبر من 15% من المبلغ")


@router.post("/expenses", status_code=201)
def add_expense(body: ExpenseIn, a: Admin = Depends(require_perm("expenses.manage"))):
    _check_vat(body)
    eid = a.conn.execute(text("""
        INSERT INTO expenses (spent_on, category, vendor, description, net_amount, vat_amount, reference, recurring, created_by)
        VALUES (:spent_on, :category, :vendor, :description, :net_amount, :vat_amount, :reference, :recurring, :u) RETURNING id"""),
        {**body.model_dump(), "u": a.user_id}).scalar_one()
    a.audit("ADMIN_EXPENSE_ADD", "expense", eid, None, {"category": body.category, "amount_sar": float(body.net_amount), "vendor": body.vendor})
    return {"id": eid}


@router.patch("/expenses/{expense_id}")
def update_expense(expense_id: UUID, body: ExpenseIn, a: Admin = Depends(require_perm("expenses.manage"))):
    _check_vat(body)
    n = a.conn.execute(text("""
        UPDATE expenses SET spent_on = :spent_on, category = :category, vendor = :vendor, description = :description,
               net_amount = :net_amount, vat_amount = :vat_amount, reference = :reference, recurring = :recurring,
               updated_at = now(), updated_by = :u
        WHERE id = :id"""), {**body.model_dump(), "u": a.user_id, "id": expense_id}).rowcount
    if not n:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "المصروف غير موجود")
    a.audit("ADMIN_EXPENSE_UPDATE", "expense", expense_id, None, {"amount_sar": float(body.net_amount), "vendor": body.vendor})
    return {"updated": True}


@router.delete("/expenses/{expense_id}")
def delete_expense(expense_id: UUID, a: Admin = Depends(require_perm("expenses.manage"))):
    row = a.conn.execute(text("DELETE FROM expenses WHERE id = :id RETURNING vendor, net_amount"), {"id": expense_id}).mappings().one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "المصروف غير موجود")
    a.audit("ADMIN_EXPENSE_DELETE", "expense", expense_id, None, {"vendor": row["vendor"], "amount_sar": float(row["net_amount"])})
    return {"deleted": True}


# ---------------------------------------------------------------- إقرار ضريبة القيمة المضافة
@router.get("/vat")
def vat_return(period: str = Query(..., pattern=r"^\d{4}-Q[1-4]$"), a: Admin = Depends(require_perm(*VIEW))):
    """ملخص الإقرار الربعي: المبيعات الخاضعة وضريبتها، والمشتريات وضريبتها القابلة للخصم، والصافي المستحق."""
    start, end = _period(period)
    p = {"s": start, "e": end}
    sales = a.conn.execute(text("""
        SELECT COALESCE(sum(CASE WHEN kind = 'INVOICE' THEN subtotal END), 0) AS sales,
               COALESCE(sum(CASE WHEN kind = 'CREDIT_NOTE' THEN subtotal END), 0) AS adjustments,
               COALESCE(sum(CASE WHEN kind = 'INVOICE' THEN vat_amount ELSE -vat_amount END), 0) AS vat
        FROM invoices WHERE issued_at >= :s AND issued_at < :e AND vat_amount > 0"""), p).mappings().one()
    purchases = a.conn.execute(text("""
        SELECT COALESCE(sum(net_amount) FILTER (WHERE vat_amount > 0), 0) AS purchases,
               COALESCE(sum(vat_amount), 0) AS vat
        FROM expenses WHERE spent_on >= :s AND spent_on < :e"""), p).mappings().one()
    out = _money([sales])[0]
    inp = _money([purchases])[0]
    # يُقدَّم الإقرار ويُسدَّد قبل نهاية الشهر التالي للربع
    return {"period": period, "from": start, "to": end, "sales": out, "purchases": inp,
            "payable": out["vat"] - inp["vat"], "file_by": _last_day(end)}


def _last_day(d: date) -> date:
    nxt = date(d.year + 1, 1, 1) if d.month == 12 else date(d.year, d.month + 1, 1)
    from datetime import timedelta
    return nxt - timedelta(days=1)


# ---------------------------------------------------------------- بيانات حصيف
@router.get("/profile")
def profile(a: Admin = Depends(require_perm(*VIEW, "expenses.manage", "billing.manage"))):
    return invoicing.seller(a.conn)


class ProfileIn(BaseModel):
    legal_name: str = Field(min_length=2, max_length=200)
    trade_name: str = Field(min_length=2, max_length=100)
    vat_registered: bool
    vat_number: str | None = Field(default=None, pattern=r"^3\d{13}3$")
    cr_number: str | None = Field(default=None, pattern=r"^\d{10}$")
    address: str | None = Field(default=None, max_length=300)
    email: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=20)
    iban: str | None = Field(default=None, pattern=r"^SA\d{22}$")
    invoice_note: str | None = Field(default=None, max_length=500)


@router.put("/profile")
def update_profile(body: ProfileIn, a: Admin = Depends(require_perm("expenses.manage"))):
    if body.vat_registered and not body.vat_number:
        raise HTTPException(422, "أدخل الرقم الضريبي (15 رقماً يبدأ وينتهي بـ 3)")
    a.conn.execute(text("""
        UPDATE haseef_profile SET legal_name = :legal_name, trade_name = :trade_name, vat_registered = :vat_registered,
               vat_number = :vat_number, cr_number = :cr_number, address = :address, email = :email, phone = :phone,
               iban = :iban, invoice_note = :invoice_note, updated_at = now(), updated_by = :u WHERE id = 1"""),
        {**body.model_dump(), "u": a.user_id})
    a.audit("ADMIN_FINANCE_PROFILE", "haseef_profile", None, None, {"vat_registered": body.vat_registered})
    return {"updated": True}


# ---------------------------------------------------------------- الاشتراك السنوي بالأقساط
class PlanIn(BaseModel):
    org_id: UUID
    plan_tier: Literal["ESSENTIAL", "PROFESSIONAL_GRC", "ENTERPRISE"]
    installments: Literal[1, 2, 3, 4, 6, 12]
    starts_on: date
    total_net: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=2)   # افتراضياً سعر الباقة السنوي
    note: str | None = Field(default=None, max_length=500)
    pay_first: bool = False
    first_reference: str | None = Field(default=None, max_length=100)


def _link() -> str:
    from ..config import get_settings
    return f"{get_settings().client_base_url}/billing"


@router.get("/plans")
def list_plans(status_: Literal["ACTIVE", "COMPLETED", "CANCELED"] | None = Query(default=None, alias="status"),
               org_id: UUID | None = None, a: Admin = Depends(require_perm("finance.view", "billing.manage"))):
    return _money(installments_service.plans(a.conn, status=status_, org_id=org_id))


@router.get("/plans/{plan_id}")
def get_plan(plan_id: UUID, a: Admin = Depends(require_perm("finance.view", "billing.manage"))):
    d = installments_service.plan_detail(a.conn, plan_id)
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "خطة الدفع غير موجودة")
    return {**_money([{k: v for k, v in d.items() if k != "items"}])[0], "items": _money(d["items"])}


@router.post("/plans", status_code=201)
def create_plan(body: PlanIn, a: Admin = Depends(require_perm("billing.manage"))):
    if not a.conn.execute(text("SELECT 1 FROM organizations WHERE id = :o"), {"o": body.org_id}).first():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "المنشأة غير موجودة")
    try:
        pid = installments_service.create_plan(a.conn, org_id=body.org_id, tier=body.plan_tier, installments=body.installments,
                                               starts_on=body.starts_on, total_net=body.total_net, note=body.note, user_id=a.user_id)
    except ValueError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    a.audit("ADMIN_PLAN_CREATE", "payment_plan", pid, body.org_id,
            {"plan": body.plan_tier, "installments": body.installments, "amount_sar": float(body.total_net or 0) or None})
    invoice = None
    if body.pay_first:
        first = a.conn.execute(text("SELECT id FROM plan_installments WHERE plan_id = :p AND seq = 1"), {"p": pid}).scalar_one()
        invoice = installments_service.pay(a.conn, plan_id=pid, installment_id=first, reference=body.first_reference, user_id=a.user_id)
    return {"id": pid, "invoice": {"id": invoice["id"], "number": invoice["number"]} if invoice else None}


class PayIn(BaseModel):
    reference: str | None = Field(default=None, max_length=100)


@router.post("/plans/{plan_id}/installments/{installment_id}/pay")
def pay_installment(plan_id: UUID, installment_id: UUID, body: PayIn, a: Admin = Depends(require_perm("billing.manage"))):
    try:
        inv = installments_service.pay(a.conn, plan_id=plan_id, installment_id=installment_id, reference=body.reference, user_id=a.user_id)
    except LookupError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    except ValueError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    org = a.conn.execute(text("SELECT org_id FROM payment_plans WHERE id = :p"), {"p": plan_id}).scalar_one()
    a.audit("ADMIN_INSTALLMENT_PAID", "plan_installment", installment_id, org,
            {"amount_sar": float(inv["total"]), "reference": body.reference, "invoice": inv["number"]})
    return {"invoice": {"id": inv["id"], "number": inv["number"]}}


@router.post("/plans/{plan_id}/installments/{installment_id}/remind")
def remind_installment(plan_id: UUID, installment_id: UUID, a: Admin = Depends(require_perm("billing.manage"))):
    from ..config import get_settings
    from ..db import platform_tx
    from ..messaging import build_senders
    if not a.conn.execute(text("SELECT 1 FROM plan_installments WHERE id = :i AND plan_id = :p"), {"i": installment_id, "p": plan_id}).first():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "القسط غير موجود")
    try:
        n = installments_service.remind_now(platform_tx, build_senders(get_settings()), installment_id, _link(), a.user_id)
    except LookupError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    a.audit("ADMIN_INSTALLMENT_REMIND", "plan_installment", installment_id, None, {"sent": n})
    return {"sent": n}


class CancelPlanIn(BaseModel):
    reason: str = Field(min_length=5, max_length=500)


@router.post("/plans/{plan_id}/cancel")
def cancel_plan(plan_id: UUID, body: CancelPlanIn, a: Admin = Depends(require_perm("billing.manage"))):
    n = a.conn.execute(text("""UPDATE payment_plans SET status = 'CANCELED', cancel_reason = :r WHERE id = :p AND status = 'ACTIVE'
                               RETURNING org_id"""), {"r": body.reason, "p": plan_id}).scalar_one_or_none()
    if n is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "الخطة غير فعّالة")
    a.audit("ADMIN_PLAN_CANCEL", "payment_plan", plan_id, n, {"reason": body.reason})
    return {"status": "CANCELED"}
