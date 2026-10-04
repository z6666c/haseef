import base64
import unittest
from decimal import Decimal

from datetime import date

from haseef.domain.finance import invoice_number, line, reminder_stage, schedule, vat_from_net, zatca_tlv


class FinanceTests(unittest.TestCase):
    def test_vat(self):
        self.assertEqual(vat_from_net(199), {"net": Decimal("199.00"), "vat": Decimal("29.85"), "total": Decimal("228.85")})
        self.assertEqual(vat_from_net(4990)["total"], Decimal("5738.50"))

    def test_line(self):
        self.assertEqual(line("x", 1, 499)["total"], 573.85)

    def test_tlv_roundtrip(self):
        raw = base64.b64decode(zatca_tlv("حصيف", "300000000000003", "2026-10-04T12:00:00Z", 228.85, 29.85))
        fields, i = [], 0
        while i < len(raw):
            n = raw[i + 1]
            fields.append(raw[i + 2:i + 2 + n].decode())
            i += 2 + n
        self.assertEqual(fields, ["حصيف", "300000000000003", "2026-10-04T12:00:00Z", "228.85", "29.85"])
        self.assertEqual(raw[0], 1)

    def test_number(self):
        self.assertEqual(invoice_number("INVOICE", 2026, 12), "HSF-2026-000012")
        self.assertEqual(invoice_number("CREDIT_NOTE", 2026, 3), "CN-2026-000003")


class ScheduleTests(unittest.TestCase):
    def test_quarterly(self):
        s = schedule(4990, 4, date(2026, 10, 1))
        self.assertEqual([x["due_date"] for x in s], [date(2026, 10, 1), date(2027, 1, 1), date(2027, 4, 1), date(2027, 7, 1)])
        self.assertEqual(sum(x["amount_net"] for x in s), Decimal("4990.00"))
        self.assertEqual(s[0]["amount_net"], Decimal("1247.50"))

    def test_rounding_on_last(self):
        s = schedule(1000, 3, date(2026, 1, 31))
        self.assertEqual([x["amount_net"] for x in s], [Decimal("333.33"), Decimal("333.33"), Decimal("333.34")])
        self.assertEqual(s[1]["due_date"], date(2026, 5, 31))

    def test_month_end_clamp(self):
        self.assertEqual(schedule(1200, 12, date(2026, 1, 31))[1]["due_date"], date(2026, 2, 28))

    def test_invalid(self):
        with self.assertRaises(ValueError):
            schedule(100, 5, date(2026, 1, 1))

    def test_stage(self):
        self.assertEqual(reminder_stage(7), "BEFORE_7")
        self.assertEqual(reminder_stage(0), "DUE")
        self.assertEqual(reminder_stage(-3), "OVERDUE_3")
        self.assertIsNone(reminder_stage(5))


if __name__ == "__main__":
    unittest.main()
