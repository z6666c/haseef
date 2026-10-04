"""حسابات الفوترة الضريبية — مطابقة لـ packages/shared/src/finance.ts."""

from __future__ import annotations

import base64
from decimal import ROUND_HALF_UP, Decimal

VAT_RATE = Decimal("0.15")


def r2(x: Decimal | float | int) -> Decimal:
    return Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def vat_from_net(net, rate: Decimal = VAT_RATE) -> dict:
    n = r2(net)
    v = r2(n * rate)
    return {"net": n, "vat": v, "total": n + v}


def line(description: str, quantity: int, unit_price, rate: Decimal = VAT_RATE) -> dict:
    v = vat_from_net(Decimal(str(unit_price)) * quantity, rate)
    return {"description": description, "quantity": quantity, "unit_price": float(r2(unit_price)),
            "net": float(v["net"]), "vat": float(v["vat"]), "total": float(v["total"])}


def zatca_tlv(seller: str, vat_number: str, timestamp: str, total, vat) -> str:
    """رمز QR للفاتورة المبسطة (المرحلة الأولى): خمسة حقول TLV ثم Base64."""
    out = bytearray()
    for tag, value in enumerate([seller, vat_number, timestamp, f"{r2(total):.2f}", f"{r2(vat):.2f}"], start=1):
        b = value.encode("utf-8")
        if len(b) > 255:
            raise ValueError("TLV field too long")
        out += bytes([tag, len(b)]) + b
    return base64.b64encode(bytes(out)).decode("ascii")


def invoice_number(kind: str, year: int, seq: int) -> str:
    return f"{'HSF' if kind == 'INVOICE' else 'CN'}-{year}-{seq:06d}"


# ---------------------------------------------------------------- الأقساط
INSTALLMENT_COUNTS = (1, 2, 3, 4, 6, 12)
REMINDER_STAGES = {"BEFORE_7": 7, "DUE": 0, "OVERDUE_3": -3}      # المرحلة ← الأيام المتبقية على الاستحقاق


def add_months(d, months: int):
    import calendar
    from datetime import date
    m = d.month - 1 + months
    y, m = d.year + m // 12, m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def schedule(total_net, count: int, starts_on) -> list[dict]:
    """جدول الأقساط: مبالغ متساوية مقرّبة، والقسط الأخير يحمل فرق التقريب حتى يطابق المجموع قيمة العقد."""
    if count not in INSTALLMENT_COUNTS:
        raise ValueError("عدد الأقساط: 1 أو 2 أو 3 أو 4 أو 6 أو 12")
    total = r2(total_net)
    each = r2(total / count)
    step = 12 // count
    out = [{"seq": i + 1, "due_date": add_months(starts_on, i * step), "amount_net": each} for i in range(count)]
    out[-1]["amount_net"] = total - each * (count - 1)
    return out


def reminder_stage(days_left: int) -> str | None:
    """المرحلة المستحقة اليوم للتذكير الآلي (قبل 7 أيام، يوم الاستحقاق، بعد 3 أيام تأخير)."""
    for stage, d in REMINDER_STAGES.items():
        if days_left == d:
            return stage
    return None
