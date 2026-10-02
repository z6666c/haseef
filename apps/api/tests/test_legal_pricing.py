import unittest
from decimal import Decimal

from haseef.domain.legal_pricing import quote


class LegalPricingTests(unittest.TestCase):
    def test_one_hour_essential(self):
        q = quote(650, 60, urgent=False, plan_tier="ESSENTIAL")
        self.assertEqual((q.base, q.discount, q.vat, q.total), (Decimal("650.00"), Decimal("0.00"), Decimal("97.50"), Decimal("747.50")))

    def test_half_hour(self):
        self.assertEqual(quote(650, 30, urgent=False, plan_tier=None).base, Decimal("325.00"))

    def test_urgent_then_plan_discount(self):
        # 950 × 1.5 = 1425، استعجال 30% = 427.50، خصم 15% من 1852.50 = 277.88، الصافي 1574.62، ضريبة 236.19
        q = quote(950, 90, urgent=True, plan_tier="PROFESSIONAL_GRC")
        self.assertEqual(q.base, Decimal("1425.00"))
        self.assertEqual(q.urgent_fee, Decimal("427.50"))
        self.assertEqual(q.discount, Decimal("277.88"))
        self.assertEqual(q.subtotal, Decimal("1574.62"))
        self.assertEqual(q.vat, Decimal("236.19"))
        self.assertEqual(q.total, Decimal("1810.81"))

    def test_enterprise_discount(self):
        self.assertEqual(quote(650, 120, urgent=False, plan_tier="ENTERPRISE").discount, Decimal("325.00"))

    def test_rejects_odd_duration(self):
        with self.assertRaises(ValueError):
            quote(650, 45, urgent=False, plan_tier=None)


if __name__ == "__main__":
    unittest.main()
