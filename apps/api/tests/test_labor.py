import unittest
from datetime import date
from decimal import Decimal as D

from haseef.domain.labor import Rate, contribution, due_date, gosi_late_penalty, periods_to_plan, pick_rate, qiwa_indicators, wps_fine

RATES = [Rate("OLD", date(2014, 1, 1), D(9), D(9), D("0.75"), D("0.75"), D(2))] + [
    Rate("NEW", d, p, p, D("0.75"), D("0.75"), D(2))
    for d, p in ((date(2024, 7, 3), D(9)), (date(2025, 7, 1), D("9.5")), (date(2026, 7, 1), D(10)), (date(2027, 7, 1), D("10.5")),
                 (date(2028, 7, 1), D(11)))] + [Rate("NON_SAUDI", date(2014, 1, 1), D(0), D(0), D(0), D(0), D(2))]


class LaborTest(unittest.TestCase):
    """نفس متجهات packages/shared/src/labor.test.ts."""

    def test_contribution(self):
        c = contribution(8000, 2000, pick_rate(RATES, "OLD", date(2026, 10, 1)))
        self.assertEqual((c["base"], c["employee"], c["employer"], c["total"]), (D(10000), D(975), D(1175), D(2150)))
        n = contribution(8000, 2000, pick_rate(RATES, "NEW", date(2026, 10, 1)))
        self.assertEqual((n["employee"], n["employer"]), (D(1075), D(1275)))
        self.assertEqual(pick_rate(RATES, "NEW", date(2026, 6, 30)).employee_annuity, D("9.5"))
        f = contribution(3000, 750, pick_rate(RATES, "NON_SAUDI", date(2026, 10, 1)))
        self.assertEqual((f["employee"], f["employer"]), (D(0), D(75)))
        self.assertEqual(contribution(1000, 0, RATES[0])["base"], D(1500))
        self.assertEqual(contribution(60000, 0, RATES[0])["base"], D(45000))

    def test_due_dates(self):
        p = date(2026, 9, 1)
        self.assertEqual(due_date("GOSI_PAYMENT", p), date(2026, 10, 15))
        self.assertEqual(due_date("WPS_UPLOAD", p), date(2026, 10, 30))
        self.assertEqual(due_date("SALARY_PAYMENT", p, 27), date(2026, 9, 27))
        self.assertEqual(due_date("WPS_UPLOAD", date(2026, 2, 1)), date(2026, 3, 30))
        self.assertEqual(due_date("GOSI_PAYMENT", date(2026, 12, 1)), date(2027, 1, 15))
        self.assertEqual(periods_to_plan(date(2026, 1, 10)), [date(2025, 12, 1), date(2026, 1, 1)])

    def test_penalties_indicators(self):
        self.assertEqual(gosi_late_penalty(2150, date(2026, 10, 15), date(2026, 10, 15)), 0)
        self.assertEqual(gosi_late_penalty(2150, date(2026, 10, 15), date(2026, 10, 16)), D(43))
        self.assertEqual(gosi_late_penalty(2150, date(2026, 10, 15), date(2026, 11, 20)), D(86))
        self.assertEqual([wps_fine(5), wps_fine(21), wps_fine(50)], [500, 1000, 2000])
        q = qiwa_indicators([{"nationality": "SAUDI", "qiwa_contract_documented": True, "gosi_registered": True},
                             {"nationality": "NON_SAUDI", "qiwa_contract_documented": False, "gosi_registered": True},
                             {"nationality": "NON_SAUDI", "is_active": False}])
        self.assertEqual((q["employees"], q["saudization_pct"], q["documented_pct"]), (2, 50.0, 50.0))


if __name__ == "__main__":
    unittest.main()
