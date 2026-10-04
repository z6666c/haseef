import base64
import unittest
from decimal import Decimal

from haseef.domain.finance import invoice_number, line, vat_from_net, zatca_tlv


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


if __name__ == "__main__":
    unittest.main()
