import hashlib
import hmac
import unittest
from datetime import date

from haseef.domain.bot import Policy, State, handle, tokens
from haseef.domain.ics import build
from haseef.domain.tax import fiscal_years, plan, vat_due, vat_periods, wht_due, zakat_due
from haseef.domain.email_templates import render

POL = [Policy("p1", "سياسة الإجازات", "1.0", "# الإجازة السنوية\nيستحق الموظف إجازة سنوية مدتها 21 يوماً، وتصبح 30 يوماً بعد خمس سنوات.\n\n"
              "# الإجازة المرضية\nتُقدَّم الإجازة المرضية بتقرير طبي معتمد خلال يومين."),
       Policy("p2", "سياسة الحضور والانصراف", "2.0", "ساعات العمل من 8 صباحاً إلى 4 مساءً، ويُسمح بتأخير 15 دقيقة.")]
FAQ = [("f1", "كيف أطلب إجازة؟", "من تطبيق الموارد البشرية قبل أسبوعين."), ("f2", "متى تصرف الرواتب؟", "يوم 27 من كل شهر.")]
# نفس الحالات في packages/shared/src/bot.test.ts
CASES = [("كم مدة الإجازة السنوية؟", "ANSWER", "p1"), ("متى يبدأ الدوام", "ANSWER", "p2"), ("كم دقيقة التأخير المسموح", "ANSWER", "p2"),
         ("كم راتب أحمد؟", "SENSITIVE", None), ("وش لون السماء", "NO_ANSWER", None), ("السياسات", "POLICIES", None),
         ("سياسة 1", "POLICY", None), ("أقر 2", "ACK", None), ("كيف اطلب اجازه", "ANSWER", "f1"), ("مساعدة", "MENU", None),
         ("سياسة 9", "POLICY_BAD", None), ("متى تصرف الرواتب", "ANSWER", "f2"), ("كم راتب سارة", "SENSITIVE", None)]


class TaxTest(unittest.TestCase):
    def test_vat(self):
        self.assertEqual(vat_periods(date(2026, 10, 9), "QUARTERLY"), [(date(2026, 7, 1), date(2026, 9, 30)), (date(2026, 10, 1), date(2026, 12, 31))])
        self.assertEqual(vat_periods(date(2026, 1, 5), "MONTHLY")[0], (date(2025, 12, 1), date(2025, 12, 31)))
        self.assertEqual(vat_due(date(2026, 9, 30)), date(2026, 10, 31))
        self.assertEqual(vat_due(date(2026, 1, 31)), date(2026, 2, 28))

    def test_wht_zakat(self):
        self.assertEqual(wht_due(date(2026, 9, 30)), date(2026, 10, 10))
        self.assertEqual(zakat_due(date(2025, 12, 31)), date(2026, 4, 30))
        self.assertEqual(fiscal_years(date(2026, 10, 9), 12), [(date(2025, 1, 1), date(2025, 12, 31)), (date(2026, 1, 1), date(2026, 12, 31))])
        self.assertEqual(fiscal_years(date(2026, 10, 9), 6)[0], (date(2025, 7, 1), date(2026, 6, 30)))
        kinds = [t["kind"] for t in plan(date(2026, 10, 9), vat_registered=True, vat_frequency="QUARTERLY", withholding=False, zakat=True, fiscal_end_month=12)]
        self.assertEqual(kinds, ["VAT_RETURN", "VAT_RETURN", "ZAKAT_RETURN", "ZAKAT_RETURN"])


class BotTest(unittest.TestCase):
    def test_cases(self):
        st = State("ACTIVE", "سارة", "النخبة", "hr@x.sa", None, POL, FAQ)
        for q, intent, src in CASES:
            r = handle(q, st)
            self.assertEqual(r.intent, intent, q)
            if src:
                self.assertTrue(r.sources[0]["id"].startswith(("pol:" + src, "faq:" + src)), (q, r.sources))

    def test_states(self):
        self.assertEqual(handle("موافق", State("INVITED", "سارة", "النخبة")).action, {"consent": True})
        self.assertEqual(handle("انضمام abc123", State(None, org_name="النخبة"), join_code_ok=True).action, {"join": "abc123"})
        self.assertEqual(handle("انضمام abc123", State(None)).intent, "JOIN_BAD")
        st = State("ACTIVE", "سارة", "النخبة", None, None, POL, FAQ, {"p1"})
        self.assertEqual(handle("أقر 1", st).intent, "ACK_DUP")
        self.assertEqual(handle("كم مدة الإجازة السنوية؟", State("ACTIVE", "س", "ن", None, None, POL, FAQ, quota_left=0)).intent, "QUOTA")

    def test_tokens(self):
        self.assertEqual(tokens("وتصبح بتأخير الإجازات"), ["تصبح", "تاخير", "اجاز"])


class IcsTemplatesTest(unittest.TestCase):
    def test_ics(self):
        out = build("ن", [{"target_type": "IQAMA", "target_id": "x", "title": "انتهاء الإقامة — محمد", "due_date": date(2026, 10, 20), "link": None}])
        self.assertIn("SUMMARY:انتهاء الإقامة — موظف", out)
        self.assertIn("DTSTART;VALUE=DATE:20261020", out)
        self.assertTrue(all(len(l.encode()) <= 75 for l in out.split("\r\n")))
        self.assertIn("محمد", build("ن", [{"target_type": "IQAMA", "target_id": "x", "title": "انتهاء الإقامة — محمد",
                                            "due_date": date(2026, 10, 20), "link": None}], include_people=True))

    def test_email_templates(self):
        subj, body = render("haseef_tax_due", ["أحمد", "إقرار ضريبة القيمة المضافة", "النخبة", "خلال 3 أيام", "31/10/2026", "https://x"])
        self.assertIn("إقرار", subj)
        self.assertNotIn("{{", body)


class WebhookTest(unittest.TestCase):
    def test_signature_and_parse(self):
        try:
            from haseef.routers.webhooks import _signature_ok, parse_messages
        except ModuleNotFoundError:
            self.skipTest("fastapi غير مثبت محلياً")
        raw = b'{"a":1}'
        sig = "sha256=" + hmac.new(b"s3cret", raw, hashlib.sha256).hexdigest()
        self.assertTrue(_signature_ok("s3cret", raw, sig))
        self.assertFalse(_signature_ok("s3cret", raw, "sha256=00"))
        msgs = parse_messages({"entry": [{"changes": [{"value": {"contacts": [{"wa_id": "966500000001", "profile": {"name": "سارة"}}],
                               "messages": [{"from": "966500000001", "type": "text", "text": {"body": "مرحبا"}}]}}]}]})
        self.assertEqual(msgs, [{"phone": "+966500000001", "body": "مرحبا", "name": "سارة"}])


if __name__ == "__main__":
    unittest.main()
