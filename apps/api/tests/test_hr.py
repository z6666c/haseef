import unittest
from datetime import date

from haseef.domain import hr

WD = [0, 1, 2, 3, 4]  # الأحد–الخميس


class LeaveTests(unittest.TestCase):
    def test_entitlement(self):
        self.assertEqual(hr.annual_entitlement(date(2022, 6, 1), date(2027, 5, 31)), 21)
        self.assertEqual(hr.annual_entitlement(date(2022, 6, 1), date(2027, 6, 1)), 30)

    def test_count_workdays_skips_weekend_and_holidays(self):
        hol = hr.holiday_dates([{"event_date": date(2027, 9, 23), "is_holiday": True, "holiday_days": 1}])
        # الأحد 19 سبتمبر 2027 إلى السبت 25: خمسة أيام عمل ناقص اليوم الوطني (الخميس)
        self.assertEqual(hr.count_days(date(2027, 9, 19), date(2027, 9, 25), work_days=WD, holidays=hol, workdays_only=True), 4)
        self.assertEqual(hr.count_days(date(2027, 9, 19), date(2027, 9, 25), work_days=WD, holidays=hol, workdays_only=False), 7)

    def test_late_return(self):
        # انتهت الخميس 7 يناير 2027، باشر الثلاثاء 12: الأحد والاثنين غياب
        self.assertEqual(hr.late_return_days(date(2027, 1, 7), date(2027, 1, 12), work_days=WD, holidays=set()), 2)
        self.assertEqual(hr.late_return_days(date(2027, 1, 7), date(2027, 1, 10), work_days=WD, holidays=set()), 0)

    def _v(self, **kw):
        base = dict(leave_type="ANNUAL", start=date(2027, 1, 10), end=date(2027, 1, 14), days=5, today=date(2027, 1, 1),
                    policy=hr.DEFAULT_POLICIES["ANNUAL"], by_hr=False, balance=21, used_this_year_type=0)
        base.update(kw)
        return hr.validate_leave(**base)

    def test_validate_leave(self):
        self.assertIsNone(self._v())
        self.assertIn("الرصيد", self._v(balance=3))
        self.assertIn("مضى", self._v(start=date(2026, 12, 30)))
        self.assertIsNone(self._v(start=date(2026, 12, 30), by_hr=True))
        em = hr.DEFAULT_POLICIES["EMERGENCY"]
        self.assertIsNone(self._v(leave_type="EMERGENCY", policy=em, start=date(2026, 12, 30), end=date(2026, 12, 30), days=1))
        self.assertIn("الحد الأقصى", self._v(leave_type="EMERGENCY", policy=em, days=4))
        self.assertIn("الحد السنوي", self._v(leave_type="EMERGENCY", policy=em, days=2, used_this_year_type=4))
        self.assertIsNone(self._v(leave_type="REGULAR", policy=hr.DEFAULT_POLICIES["REGULAR"], balance=0, is_paid=False))


class SickTests(unittest.TestCase):
    def test_tiers(self):
        self.assertEqual(hr.sick_split(0, 10), [(10, 1.0)])
        self.assertEqual(hr.sick_split(25, 10), [(5, 1.0), (5, 0.75)])
        self.assertEqual(hr.sick_split(85, 10), [(5, 0.75), (5, 0.0)])
        self.assertEqual(hr.sick_note(25, 10), "5 يوم بأجر كامل، 5 يوم بثلاثة أرباع الأجر")

    def test_backdate(self):
        p = hr.DEFAULT_POLICIES["SICK"]
        kw = dict(leave_type="SICK", end=date(2027, 1, 2), days=2, today=date(2027, 1, 5), policy=p, by_hr=False, balance=0, used_this_year_type=0)
        self.assertIsNone(hr.validate_leave(start=date(2026, 12, 30), **kw))
        self.assertIn("المرضية", hr.validate_leave(start=date(2026, 12, 20), **kw))
        self.assertIn("الحد السنوي", hr.validate_leave(start=date(2026, 12, 30), **{**kw, "used_this_year_type": 119}))


class AttachmentTests(unittest.TestCase):
    def test_sniff(self):
        self.assertEqual(hr.sniff_mime(b"%PDF-1.7 ..."), "application/pdf")
        self.assertEqual(hr.sniff_mime(b"\xff\xd8\xff\xe0rest"), "image/jpeg")
        self.assertEqual(hr.sniff_mime(b"\x89PNG\r\n\x1a\nrest"), "image/png")
        self.assertIsNone(hr.sniff_mime(b"<html><script>"))
        self.assertIsNone(hr.sniff_mime(b"MZ\x90\x00"))

    def test_safe_name(self):
        self.assertEqual(hr.safe_file_name("../../etc/passwd", "application/pdf"), ".._.._etc_passwd.pdf")
        self.assertEqual(hr.safe_file_name("تقرير.jpg", "image/jpeg"), "تقرير.jpg")
        self.assertEqual(hr.safe_file_name("", "image/png"), "مرفق.png")


class PayChoiceTests(LeaveTests):
    def test_pay_choice(self):
        reg, ann = hr.DEFAULT_POLICIES["REGULAR"], hr.DEFAULT_POLICIES["ANNUAL"]
        self.assertTrue(hr.resolve_paid(reg, None))
        self.assertFalse(hr.resolve_paid(reg, False))
        self.assertTrue(hr.resolve_paid(ann, False))
        self.assertFalse(hr.resolve_paid({**reg, "pay_mode": "UNPAID"}, True))
        self.assertIn("الرصيد", self._v(leave_type="REGULAR", policy=reg, balance=2, is_paid=True))
        self.assertIsNone(self._v(leave_type="REGULAR", policy=reg, balance=0, is_paid=False))


class DeductionTests(unittest.TestCase):
    def _v(self, **kw):
        base = dict(kind="LATE", amount=100, incident=date(2027, 1, 10), today=date(2027, 1, 15), dwage=300, monthly_wage=9000,
                    month_fines=0, month_total=0)
        base.update(kw)
        return hr.validate_deduction(**base)

    def test_caps(self):
        self.assertEqual(hr.daily_wage(7000, 2000), 300)
        self.assertEqual(hr.late_amount(48, 300, 480), 30)
        self.assertIsNone(self._v())
        self.assertIn("خمسة أيام", self._v(amount=1501))
        self.assertIn("في الشهر", self._v(amount=600, month_fines=1000))
        self.assertIn("30 يوماً", self._v(incident=date(2026, 12, 1)))
        # الغياب لا يخضع لسقف الغرامات ولا لمهلة الثلاثين يوماً، لكنه يخضع لسقف النصف
        self.assertIsNone(self._v(kind="ABSENCE", amount=3000, incident=date(2026, 12, 1)))
        self.assertIn("نصف الأجر", self._v(kind="ABSENCE", amount=3000, month_total=2000))


if __name__ == "__main__":
    unittest.main()


class PromoTemplateTests(unittest.TestCase):
    def test_promo_ending_renders(self):
        from haseef.domain.email_templates import render
        subject, body = render("haseef_promo_ending", ["سارة", "منشأة النخبة", "الموارد البشرية — حتى 25 موظفاً", "بعد 5 أيام",
                                                        "14 نوفمبر 2026", "149 ريال", "https://app.haseef.sa/billing"])
        self.assertIn("بعد 5 أيام", subject)
        self.assertNotIn("{{", subject + body)
        self.assertIn("149 ريال", body)
