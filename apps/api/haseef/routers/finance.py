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

Category = Literal["HOSTING", "AI", "MESSAGING", "PAYMENT_FEES", "SALARIES", "GOSI", "QIWA", "LAWYER_FEES", "MARKETING",
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
    by_cycle = _money(c.execute(text("""
        SELECT CASE WHEN source = 'SUBSCRIPTION' THEN COALESCE(plan_cycle, 'YEARLY') ELSE source END AS cycle,
               sum(CASE WHEN kind = 'INVOICE' THEN subtotal ELSE -subtotal END) AS net, count(*) FILTER (WHERE kind = 'INVOICE') AS invoices
        FROM invoices WHERE issued_at >= :s AND issued_at < :e GROUP BY 1 ORDER BY 1"""), p).mappings())
    mrr_split = _money(c.execute(text("""
        SELECT s.billing_cycle AS cycle, count(*) AS subscribers,
               COALESCE(sum(CASE WHEN s.billing_cycle = 'YEARLY' THEN p.yearly_price_sar / 12.0 ELSE p.monthly_price_sar END), 0) AS mrr
        FROM subscriptions s JOIN plans p ON p.tier = s.plan_tier WHERE s.billing_status = 'ACTIVE'
        GROUP BY s.billing_cycle ORDER BY 1""")).mappings())
    fixed = c.execute(text("""
        SELECT COALESCE(sum(net_amount) FILTER (WHERE frequency = 'MONTHLY' AND spent_on > current_date - 31), 0) AS monthly,
               COALESCE(sum(net_amount) FILTER (WHERE frequency = 'YEARLY' AND spent_on > current_date - 365), 0) / 12.0 AS yearly_share
        FROM expenses""")).mappings().one()
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
            "revenue": {"total": revenue, "by_source": rev, "by_cycle": by_cycle},
            "mrr_split": mrr_split,
            "fixed_costs": {"monthly": float(fixed["monthly"]), "yearly_share": round(float(fixed["yearly_share"]), 2),
                            "total": round(float(fixed["monthly"]) + float(fixed["yearly_share"]), 2)},
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
             cycle: Literal["MONTHLY", "YEARLY", "CONSULTATION"] | None = None,
             a: Admin = Depends(require_perm("finance.view", "billing.manage"))):
    start, end = _period(period) if period else (date(2000, 1, 1), date(2100, 1, 1))
    rows = a.conn.execute(text("""
        SELECT i.id, i.number, i.kind, i.source, i.org_id, i.buyer_name, i.subtotal, i.vat_amount, i.total,
               i.issued_at, i.status, i.payment_reference, i.plan_cycle, r.number AS related_number
        FROM invoices i LEFT JOIN invoices r ON r.id = i.related_invoice_id
        WHERE i.issued_at >= :s AND i.issued_at < :e
          AND (CAST(:q AS text) IS NULL OR i.number ILIKE '%' || :q || '%' OR i.buyer_name ILIKE '%' || :q || '%')
          AND (CAST(:cy AS text) IS NULL OR (CAST(:cy AS text) = 'CONSULTATION' AND i.source = 'CONSULTATION')
               OR (i.source = 'SUBSCRIPTION' AND i.plan_cycle = :cy))
        ORDER BY i.issued_at DESC LIMIT 500"""), {"s": start, "e": end, "q": q or None, "cy": cycle}).mappings()
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
    frequency: Literal["ONE_TIME", "MONTHLY", "YEARLY"] = "ONE_TIME"


@router.get("/expenses")
def expenses(period: str | None = None, category: Category | None = None,
             frequency: Literal["ONE_TIME", "MONTHLY", "YEARLY"] | None = None,
             a: Admin = Depends(require_perm(*VIEW, "expenses.manage"))):
    start, end = _period(period) if period else (date(2000, 1, 1), date(2100, 1, 1))
    rows = a.conn.execute(text("""
        SELECT e.id, e.spent_on, e.category, e.vendor, e.description, e.net_amount, e.vat_amount, e.total, e.reference,
               e.frequency, e.created_at, u.full_name AS created_by_name
        FROM expenses e LEFT JOIN users u ON u.id = e.created_by
        WHERE e.spent_on >= :s AND e.spent_on < :e AND (CAST(:c AS text) IS NULL OR e.category = :c)
          AND (CAST(:f AS text) IS NULL OR e.frequency = :f)
        ORDER BY e.spent_on DESC, e.created_at DESC LIMIT 1000"""), {"s": start, "e": end, "c": category, "f": frequency}).mappings()
    return _money(rows)


def _check_vat(body: ExpenseIn) -> None:
    if body.vat_amount > body.net_amount * Decimal("0.15") + Decimal("0.05"):
        raise HTTPException(422, "ضريبة المدخلات أكبر من 15% من المبلغ")


@router.post("/expenses", status_code=201)
def add_expense(body: ExpenseIn, a: Admin = Depends(require_perm("expenses.manage"))):
    _check_vat(body)
    eid = a.conn.execute(text("""
        INSERT INTO expenses (spent_on, category, vendor, description, net_amount, vat_amount, reference, frequency, created_by)
        VALUES (:spent_on, :category, :vendor, :description, :net_amount, :vat_amount, :reference, :frequency, :u) RETURNING id"""),
        {**body.model_dump(), "u": a.user_id}).scalar_one()
    a.audit("ADMIN_EXPENSE_ADD", "expense", eid, None, {"category": body.category, "amount_sar": float(body.net_amount), "vendor": body.vendor})
    return {"id": eid}


@router.patch("/expenses/{expense_id}")
def update_expense(expense_id: UUID, body: ExpenseIn, a: Admin = Depends(require_perm("expenses.manage"))):
    _check_vat(body)
    n = a.conn.execute(text("""
        UPDATE expenses SET spent_on = :spent_on, category = :category, vendor = :vendor, description = :description,
               net_amount = :net_amount, vat_amount = :vat_amount, reference = :reference, frequency = :frequency,
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


# ---------------------------------------------------------------- قائمة الدخل شهرياً أو سنوياً
REV_ROWS = [("MONTHLY", "اشتراكات شهرية"), ("YEARLY", "اشتراكات سنوية"), ("CONSULTATION", "استشارات قانونية"), ("MANUAL", "إيرادات أخرى")]
EXP_LABEL = {"HOSTING": "الاستضافة والخوادم", "AI": "الذكاء الاصطناعي", "MESSAGING": "واتساب والبريد", "PAYMENT_FEES": "رسوم بوابة الدفع",
             "SALARIES": "الرواتب والتأمينات", "LAWYER_FEES": "أتعاب المحامين", "MARKETING": "التسويق",
             "PROFESSIONAL": "المحاسبة والاستشارات المهنية", "GOVERNMENT": "الرسوم الحكومية والتراخيص", "SOFTWARE": "البرامج والأدوات",
             "OFFICE": "المكتب ومساحة العمل", "OTHER": "أخرى"}


@router.get("/statement")
def statement(view: Literal["monthly", "yearly"] = "monthly", year: int | None = None, years: int = Query(default=3, ge=2, le=6),
              allocate: bool = True, a: Admin = Depends(require_perm(*VIEW))):
    """قائمة دخل بأعمدة: أشهر سنة واحدة، أو سنوات متتالية. allocate يوزّع المصروف السنوي على 12 شهراً من تاريخه."""
    from ..services.installments_service import today_riyadh
    from ..domain.finance import add_months
    this_year = today_riyadh().year
    if view == "monthly":
        y = year or this_year
        cols = [f"{y}-{m:02d}" for m in range(1, 13)]
        start, end = date(y, 1, 1), date(y + 1, 1, 1)
        key = lambda ym: ym                                       # noqa: E731
    else:
        last = year or this_year
        cols = [str(y) for y in range(last - years + 1, last + 1)]
        start, end = date(int(cols[0]), 1, 1), date(last + 1, 1, 1)
        key = lambda ym: ym[:4]                                   # noqa: E731
    idx = {c: i for i, c in enumerate(cols)}
    rev = a.conn.execute(text("""
        SELECT to_char(issued_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM') AS ym,
               CASE WHEN source = 'SUBSCRIPTION' THEN COALESCE(plan_cycle, 'YEARLY') ELSE source END AS k,
               sum(CASE WHEN kind = 'INVOICE' THEN subtotal ELSE -subtotal END) AS amt
        FROM invoices WHERE issued_at >= :s AND issued_at < :e GROUP BY 1, 2"""), {"s": start, "e": end}).mappings()
    rows: dict[str, list[float]] = {}
    for r_ in rev:
        rows.setdefault(r_["k"], [0.0] * len(cols))[idx[key(r_["ym"])]] += float(r_["amt"])
    exp = a.conn.execute(text("""
        SELECT spent_on, category, net_amount, frequency FROM expenses
        WHERE spent_on >= CAST(:s AS date) - 365 AND spent_on < :e"""), {"s": start, "e": end}).mappings()
    erows: dict[str, list[float]] = {}
    for e_ in exp:
        amt = float(e_["net_amount"])
        parts = [(e_["spent_on"], amt)]
        if allocate and e_["frequency"] == "YEARLY":
            parts = [(add_months(e_["spent_on"], i), amt / 12) for i in range(12)]
        for d, v in parts:
            k = key(d.strftime("%Y-%m"))
            if k in idx:
                erows.setdefault(e_["category"], [0.0] * len(cols))[idx[k]] += v
    def row(group, k, label, vals):
        vals = [round(v, 2) for v in vals]
        return {"group": group, "key": k, "label": label, "values": vals, "total": round(sum(vals), 2)}
    out = [row("revenue", k, label, rows[k]) for k, label in REV_ROWS if k in rows]
    rev_tot = [sum(r_["values"][i] for r_ in out) for i in range(len(cols))]
    exp_rows = sorted((row("expenses", k, EXP_LABEL.get(k, k), v) for k, v in erows.items()), key=lambda x: -x["total"])
    exp_tot = [sum(r_["values"][i] for r_ in exp_rows) for i in range(len(cols))]
    return {"view": view, "columns": cols, "allocate": allocate,
            "revenue": out, "revenue_total": row("total", "revenue", "إجمالي الإيرادات", rev_tot),
            "expenses": exp_rows, "expenses_total": row("total", "expenses", "إجمالي المصروفات", exp_tot),
            "net": row("net", "net", "صافي الربح (الخسارة)", [rev_tot[i] - exp_tot[i] for i in range(len(cols))])}
