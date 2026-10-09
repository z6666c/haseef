"""الدفع الإلكتروني من العميل: الاشتراك (شهري/سنوي)، أقساط الخطة السنوية، والإضافات (بوت الواتساب).

المسار: نية دفع ← فاتورة مستضافة لدى البوابة ← العميل يدفع ← إشعار من البوابة أو عودة العميل
← حصيف يسأل البوابة عن الحالة والمبلغ ← يُعتمد الدفع مرة واحدة فقط (قفل على النية) ← فاتورة ضريبية تلقائية.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import Connection, text

from ..config import get_settings
from ..db import platform_tx
from ..deps import Tenant, get_tenant
from ..domain.finance import r2
from ..messaging import build_senders
from ..payments import build_gateway
from ..services import billing_service, installments_service, pricing
from ..services.score_service import recompute

router = APIRouter(tags=["payments"])
PAYERS = ("ORG_ADMIN", "COMPLIANCE_OFFICER")
PLAN_NAME = {"ESSENTIAL": "باقة الأساس", "PROFESSIONAL_GRC": "باقة الحوكمة والنمو", "ENTERPRISE": "باقة كبار العملاء"}


def _f(v):
    return float(v) if isinstance(v, Decimal) else v


def _gateway():
    try:
        return build_gateway(get_settings())
    except RuntimeError:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "الدفع الإلكتروني غير مهيأ بعد. تواصل مع فريق حصيف للسداد.")


def _vat_rate(c: Connection) -> Decimal:
    return Decimal("0.15") if c.execute(text("SELECT vat_registered FROM haseef_profile WHERE id = 1")).scalar_one() else Decimal("0")


@router.get("/billing/checkout/options")
def options(t: Tenant = Depends(get_tenant)):
    with platform_tx() as c:
        sub = billing_service.live_sub(c, t.org_id)
        due = c.execute(text("""
            SELECT i.id, i.seq, i.due_date, i.amount_net, p.installments FROM plan_installments i
            JOIN payment_plans p ON p.id = i.plan_id
            WHERE p.org_id = :o AND p.status = 'ACTIVE' AND i.paid_at IS NULL ORDER BY i.seq LIMIT 1"""),
            {"o": t.org_id}).mappings().one_or_none()
        bot = pricing.addon_access(c, t.org_id, "WA_BOT")
        return {"plans": pricing.plans(c), "addons": pricing.addons(c), "vat_rate": float(_vat_rate(c)),
                "subscription": {k: _f(v) for k, v in sub.items() if k in ("plan_tier", "billing_cycle", "billing_status", "ends_at")} if sub else None,
                "next_installment": {k: _f(v) for k, v in dict(due).items()} if due else None,
                "bot": {**bot, "paid_until": bot["paid_until"]}, "can_pay": t.role in PAYERS,
                "provider": get_settings().payment_provider}


class CheckoutIn(BaseModel):
    purpose: Literal["SUBSCRIPTION", "INSTALLMENT", "ADDON"]
    plan_tier: Literal["ESSENTIAL", "PROFESSIONAL_GRC", "ENTERPRISE"] | None = None
    billing_cycle: Literal["MONTHLY", "YEARLY"] = "MONTHLY"
    installment_id: UUID | None = None
    addon_code: str | None = None


@router.post("/billing/checkout", status_code=201)
def checkout(body: CheckoutIn, t: Tenant = Depends(get_tenant)):
    t.require(*PAYERS)
    s = get_settings()
    gw = _gateway()
    with platform_tx() as c:
        rate = _vat_rate(c)
        if body.purpose == "SUBSCRIPTION":
            sub = billing_service.live_sub(c, t.org_id)
            tier = body.plan_tier or (sub["plan_tier"] if sub else None)
            if not tier:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "اختر الباقة")
            if c.execute(text("SELECT 1 FROM payment_plans WHERE org_id = :o AND status = 'ACTIVE'"), {"o": t.org_id}).first():
                raise HTTPException(status.HTTP_409_CONFLICT, "لديك خطة أقساط سنوية فعّالة؛ ادفع القسط المستحق بدلاً من ذلك")
            p = next(x for x in pricing.plans(c) if x["tier"] == tier)
            net = Decimal(str(p["yearly_price_sar"] if body.billing_cycle == "YEARLY" else p["monthly_price_sar"]))
            desc = f"اشتراك {PLAN_NAME[tier]} — {'سنة' if body.billing_cycle == 'YEARLY' else 'شهر'}"
            extra = {"plan_tier": tier, "billing_cycle": body.billing_cycle}
        elif body.purpose == "INSTALLMENT":
            row = c.execute(text("""
                SELECT i.id, i.seq, i.amount_net, i.paid_at, p.installments, p.plan_tier FROM plan_installments i
                JOIN payment_plans p ON p.id = i.plan_id
                WHERE i.id = :i AND p.org_id = :o AND p.status = 'ACTIVE'"""), {"i": body.installment_id, "o": t.org_id}).mappings().one_or_none()
            if row is None or row["paid_at"]:
                raise HTTPException(status.HTTP_409_CONFLICT, "القسط غير موجود أو مدفوع")
            net = Decimal(row["amount_net"])
            desc = f"اشتراك سنوي {PLAN_NAME.get(row['plan_tier'], '')} — القسط {row['seq']} من {row['installments']}"
            extra = {"installment_id": row["id"], "plan_tier": row["plan_tier"], "billing_cycle": "YEARLY"}
        else:
            a = pricing.addon(c, body.addon_code or "")
            if not a or not a["is_active"]:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "الإضافة غير متاحة")
            acc = pricing.addon_access(c, t.org_id, a["code"])
            if acc["via"] == "PLAN":
                raise HTTPException(status.HTTP_409_CONFLICT, "هذه الإضافة مشمولة في باقتك مجاناً")
            if not acc["plan_tier"]:
                raise HTTPException(status.HTTP_409_CONFLICT, "فعّل اشتراكك أولاً")
            net = Decimal(str(a["monthly_price"]))
            desc = f"{a['name']} — اشتراك شهر"
            extra = {"addon_code": a["code"]}
        vat = r2(net * rate)
        total = net + vat
        iid = c.execute(text("""
            INSERT INTO payment_intents (org_id, purpose, plan_tier, billing_cycle, installment_id, addon_code, description,
                                         amount_net, vat_amount, total, provider, created_by)
            VALUES (:o, :p, :tier, :cycle, :inst, :addon, :d, :n, :v, :t, :prov, :u) RETURNING id"""),
            {"o": t.org_id, "p": body.purpose, "tier": extra.get("plan_tier"), "cycle": extra.get("billing_cycle"),
             "inst": extra.get("installment_id"), "addon": extra.get("addon_code"), "d": desc, "n": net, "v": vat,
             "t": total, "prov": gw.name, "u": t.principal.user_id}).scalar_one()
        back = f"{s.client_base_url}/billing/pay/?intent={iid}"
        co = gw.create(intent_id=str(iid), amount_halalas=int((total * 100).to_integral_value()), description=desc,
                       callback_url=f"{s.api_public_url}/v1/payments/moyasar/callback", success_url=back, back_url=back)
        c.execute(text("UPDATE payment_intents SET provider_ref = :r, checkout_url = :u WHERE id = :i"),
                  {"r": co.ref, "u": co.url, "i": iid})
    return {"intent_id": iid, "checkout_url": co.url, "total": float(total)}


def _confirm(c: Connection, intent_id, *, verified_amount_halalas: int | None) -> dict:
    """يعتمد النية المدفوعة مرة واحدة فقط ويطبقها على الاشتراك أو القسط أو الإضافة."""
    it = c.execute(text("SELECT * FROM payment_intents WHERE id = :i FOR UPDATE"), {"i": intent_id}).mappings().one()
    if it["status"] == "PAID":
        return dict(it)
    if verified_amount_halalas is not None and verified_amount_halalas != int((Decimal(it["total"]) * 100).to_integral_value()):
        c.execute(text("UPDATE payment_intents SET status = 'FAILED' WHERE id = :i"), {"i": intent_id})
        raise ValueError("المبلغ المدفوع لا يطابق المطلوب")
    ref = f"{it['provider']}:{it['provider_ref']}"
    if it["purpose"] == "SUBSCRIPTION":
        inv = billing_service.apply_subscription_payment(c, org_id=it["org_id"], tier=it["plan_tier"], cycle=it["billing_cycle"],
                                                         amount_net=it["amount_net"], reference=ref, note="دفع إلكتروني",
                                                         user_id=it["created_by"])["invoice"]
    elif it["purpose"] == "INSTALLMENT":
        plan_id = c.execute(text("SELECT plan_id FROM plan_installments WHERE id = :i"), {"i": it["installment_id"]}).scalar_one()
        inv = installments_service.pay(c, plan_id=plan_id, installment_id=it["installment_id"], reference=ref, user_id=it["created_by"])
    else:
        a = pricing.addon(c, it["addon_code"])
        inv = billing_service.apply_addon_payment(c, org_id=it["org_id"], code=it["addon_code"], name=a["name"],
                                                  amount_net=it["amount_net"], reference=ref, user_id=it["created_by"])["invoice"]
    c.execute(text("UPDATE payment_intents SET status = 'PAID', paid_at = now(), invoice_id = :inv WHERE id = :i"),
              {"inv": inv["id"], "i": intent_id})
    c.execute(text("""INSERT INTO audit_log (org_id, actor_user_id, action, entity_type, entity_id, changes)
                      VALUES (:o, :u, 'ONLINE_PAYMENT', 'payment_intent', :i, jsonb_build_object('total', CAST(:t AS text), 'ref', CAST(:r AS text)))"""),
              {"o": it["org_id"], "u": it["created_by"], "i": intent_id, "t": str(it["total"]), "r": ref})
    recompute(c, it["org_id"])
    contact = billing_service.org_contact(c, it["org_id"])
    if contact:
        try:
            build_senders(get_settings())["EMAIL"].send(contact["email"], "haseef_payment_receipt", [
                contact["full_name"], contact["org_name"], it["description"], f"{it['total']} ريال",
                f"{get_settings().client_base_url}/billing"])
        except Exception:                        # الإيصال لا يُفشل الدفع
            pass
    return {**dict(it), "status": "PAID", "invoice_id": inv["id"]}


def _out(it: dict) -> dict:
    keys = ("id", "purpose", "description", "amount_net", "vat_amount", "total", "status", "created_at", "paid_at", "invoice_id", "provider")
    return {k: _f(it[k]) for k in keys}


@router.get("/billing/checkout/{intent_id}")
def intent_status(intent_id: UUID, t: Tenant = Depends(get_tenant)):
    """يُستدعى عند عودة العميل من صفحة الدفع: إن لم يصل الإشعار بعد، نسأل البوابة مباشرة."""
    with platform_tx() as c:
        it = c.execute(text("SELECT * FROM payment_intents WHERE id = :i AND org_id = :o"), {"i": intent_id, "o": t.org_id}).mappings().one_or_none()
        if it is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "عملية الدفع غير موجودة")
        it = dict(it)
        if it["status"] == "INITIATED" and it["provider"] != "FAKE":
            st = _gateway().fetch(it["provider_ref"])
            if st["status"] == "paid":
                try:
                    it = _confirm(c, intent_id, verified_amount_halalas=st.get("amount"))
                except ValueError as e:
                    raise HTTPException(status.HTTP_409_CONFLICT, str(e))
            elif st["status"] in ("failed", "canceled", "expired", "voided"):
                c.execute(text("UPDATE payment_intents SET status = 'FAILED' WHERE id = :i"), {"i": intent_id})
                it["status"] = "FAILED"
        return _out(it)


@router.post("/billing/checkout/{intent_id}/sandbox-pay")
def sandbox_pay(intent_id: UUID, t: Tenant = Depends(get_tenant)):
    """البوابة التجريبية فقط (خارج الإنتاج): محاكاة نجاح الدفع."""
    s = get_settings()
    if s.payment_provider != "fake" or s.env == "production":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "غير متاح")
    t.require(*PAYERS)
    with platform_tx() as c:
        if not c.execute(text("SELECT 1 FROM payment_intents WHERE id = :i AND org_id = :o"), {"i": intent_id, "o": t.org_id}).first():
            raise HTTPException(status.HTTP_404_NOT_FOUND, "عملية الدفع غير موجودة")
        return _out(_confirm(c, intent_id, verified_amount_halalas=None))


@router.post("/payments/moyasar/callback")
async def moyasar_callback(request: Request):
    """إشعار ميسّر. لا نعتمد على محتواه: نأخذ المعرّف فقط ونسأل البوابة عن الحالة والمبلغ."""
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "طلب غير صالح")
    ref = str((data or {}).get("id") or "")[:100]
    if not ref:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "طلب غير صالح")
    with platform_tx() as c:
        it = c.execute(text("SELECT id, status FROM payment_intents WHERE provider = 'MOYASAR' AND provider_ref = :r"),
                       {"r": ref}).mappings().one_or_none()
        if it is None:
            return {"ok": True}                  # لا نكشف وجود المعرّفات
        if it["status"] == "INITIATED":
            st = _gateway().fetch(ref)
            if st["status"] == "paid":
                try:
                    _confirm(c, it["id"], verified_amount_halalas=st.get("amount"))
                except ValueError:
                    pass
    return {"ok": True}


@router.get("/billing/payments")
def my_payments(t: Tenant = Depends(get_tenant)):
    with platform_tx() as c:
        return [_out(dict(r)) for r in c.execute(text("""SELECT * FROM payment_intents WHERE org_id = :o
                                                         ORDER BY created_at DESC LIMIT 50"""), {"o": t.org_id}).mappings()]
