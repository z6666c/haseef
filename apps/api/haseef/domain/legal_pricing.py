"""تسعير الاستشارات القانونية بالساعة — منطق نقي قابل للاختبار.

السعر = سعر الساعة للمجال × المدة، + رسم الاستعجال، − خصم الباقة، ثم ضريبة القيمة المضافة.
كل المبالغ بالريال ومقرّبة لهللتين. الخصم يُطبَّق بعد رسم الاستعجال.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from decimal import ROUND_HALF_UP, Decimal

VAT_PCT = Decimal("15")
URGENT_PCT = Decimal("30")
PLAN_DISCOUNT_PCT = {"ESSENTIAL": Decimal("0"), "PROFESSIONAL_GRC": Decimal("15"), "ENTERPRISE": Decimal("25")}
ALLOWED_MINUTES = (30, 60, 90, 120, 180, 240)


def _r(x: Decimal) -> Decimal:
    return x.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class Quote:
    hourly_rate: Decimal
    minutes: int
    base: Decimal
    urgent_pct: Decimal
    urgent_fee: Decimal
    discount_pct: Decimal
    discount: Decimal
    subtotal: Decimal
    vat_pct: Decimal
    vat: Decimal
    total: Decimal

    def as_dict(self) -> dict:
        return {k: (float(v) if isinstance(v, Decimal) else v) for k, v in asdict(self).items()}


def quote(hourly_rate: Decimal | float | int, minutes: int, *, urgent: bool, plan_tier: str | None) -> Quote:
    if minutes not in ALLOWED_MINUTES:
        raise ValueError("مدة غير مدعومة")
    rate = Decimal(str(hourly_rate))
    if rate <= 0:
        raise ValueError("سعر الساعة غير صالح")
    base = _r(rate * minutes / 60)
    u_pct = URGENT_PCT if urgent else Decimal("0")
    urgent_fee = _r(base * u_pct / 100)
    d_pct = PLAN_DISCOUNT_PCT.get(plan_tier or "", Decimal("0"))
    discount = _r((base + urgent_fee) * d_pct / 100)
    subtotal = base + urgent_fee - discount
    vat = _r(subtotal * VAT_PCT / 100)
    return Quote(rate, minutes, base, u_pct, urgent_fee, d_pct, discount, subtotal, VAT_PCT, vat, subtotal + vat)
