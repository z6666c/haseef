import unittest

from haseef.domain.pii import redact, restore
from haseef.domain.score import ItemState, PolicyState, RopaState, ScoreInputs, compute_score

ESSENTIAL = frozenset({"OPERATIONAL", "CONTRACTS"})
PRO = frozenset({"OPERATIONAL", "CONTRACTS", "GOVERNANCE", "PDPL"})


class ScoreTests(unittest.TestCase):
    def test_no_data_is_unrated_not_100(self):
        self.assertIsNone(compute_score(ScoreInputs(plan_features=PRO)).score)

    def test_essential_not_penalised_for_missing_governance(self):
        r = compute_score(ScoreInputs(plan_features=ESSENTIAL, items=[ItemState(200)], audit_percentages=[100]))
        self.assertEqual(r.score, 100)
        self.assertNotIn("GOVERNANCE_PDPL", r.weights_used)
        self.assertAlmostEqual(sum(r.weights_used.values()), 100, places=1)

    def test_weights_renormalised(self):
        # تشغيلي 100 وعقود 50 فقط: (35*100 + 30*50) / 65 = 76.9
        r = compute_score(ScoreInputs(plan_features=PRO, items=[ItemState(90)], audit_percentages=[50]))
        self.assertEqual(r.score, 77)

    def test_full_formula(self):
        r = compute_score(ScoreInputs(
            plan_features=PRO,
            items=[ItemState(90)],                                         # 100
            policies=[PolicyState(10, policy_type="PRIVACY_POLICY"), PolicyState(-1)],  # 50
            ropa=[RopaState(True, True, True)],                            # 100 → ركن الحوكمة 75
            audit_percentages=[80],                                        # 80
        ))
        # 0.35*100 + 0.35*75 + 0.30*80 = 85.25
        self.assertEqual(r.score, 85)

    def test_risk_weighting(self):
        # عنصر حرج منتهٍ (وزن 3، رصيد 0) + متوسط سليم (وزن 1) → 25، والسقف لا يرفعه
        r = compute_score(ScoreInputs(plan_features=ESSENTIAL,
                                      items=[ItemState(-1, "CRITICAL"), ItemState(100, "MEDIUM")]))
        self.assertEqual(r.score, 25)

    def test_critical_expiry_caps_score(self):
        many_good = [ItemState(200, "MEDIUM")] * 20
        r = compute_score(ScoreInputs(plan_features=ESSENTIAL,
                                      items=many_good + [ItemState(-1, "CRITICAL")], audit_percentages=[100]))
        self.assertEqual(r.score, 50)
        self.assertTrue(r.capped)


class PiiTests(unittest.TestCase):
    SAMPLE = (
        "الطرف الثاني: محمد، هوية رقم 1023456789، جوال 0551234567، "
        "البريد m.ali@example.com، الآيبان SA03 8000 0000 6080 1016 7519، "
        "ورقم إقامة الزوجة ٢٣٤٥٦٧٨٩٠١. يتقاضى 8000 ريال."
    )

    def test_redacts_saudi_identifiers(self):
        r = redact(self.SAMPLE)
        for raw in ("1023456789", "0551234567", "m.ali@example.com", "SA03", "2345678901"):
            self.assertNotIn(raw, r.text, raw)
        self.assertEqual(r.counts, {"IBAN": 1, "EMAIL": 1, "PHONE": 1, "NATIONAL_ID": 2})

    def test_keeps_non_personal_numbers(self):
        self.assertIn("8000 ريال", redact(self.SAMPLE).text)

    def test_roundtrip(self):
        r = redact(self.SAMPLE)
        restored = restore(r.text, r.mapping)
        self.assertIn("1023456789", restored)
        self.assertIn("2345678901", restored)   # الأرقام الهندية تُعاد بصيغة لاتينية

    def test_same_value_same_token(self):
        r = redact("الهوية 1023456789 ثم مرة أخرى 1023456789")
        self.assertEqual(r.text.count("[NATIONAL_ID_1]"), 2)

    def test_international_phone(self):
        self.assertIn("[PHONE_1]", redact("للتواصل +966 551234567").text)


if __name__ == "__main__":
    unittest.main()


class ReasonTests(unittest.TestCase):
    def test_reasons_carry_real_point_loss(self):
        # بلدي حرج منتهٍ (وزن 3، يخسر كله) + سجل ساري (وزن 3): الركن 50% بوزن 100% ← خسارة 50 نقطة
        r = compute_score(ScoreInputs(plan_features=frozenset({"OPERATIONAL"}), items=[
            ItemState(-2, "CRITICAL", "رخصة بلدي"), ItemState(200, "CRITICAL", "السجل التجاري")]))
        self.assertEqual(r.score, 50)
        top = r.as_dict()["reasons"][0]
        self.assertEqual(top["text"], "انتهت صلاحية رخصة بلدي منذ يومين")
        self.assertEqual(top["points"], 50)
        self.assertEqual(top["severity"], "critical")

    def test_reasons_sum_matches_score(self):
        inp = ScoreInputs(plan_features=PRO,
                          items=[ItemState(5, "HIGH", "التأمين الطبي"), ItemState(90, "HIGH", "السجل")],
                          policies=[PolicyState(10, "تعارض المصالح", "CONFLICT_OF_INTEREST"),
                                    PolicyState(20, "سياسة الخصوصية", "PRIVACY_POLICY")],
                          audit_percentages=[80])
        r = compute_score(inp)
        lost = sum(x["points"] for x in r.as_dict()["reasons"])
        self.assertAlmostEqual(100 - r.score, lost, delta=1)   # التقريب فقط

    def test_missing_privacy_policy_is_flagged(self):
        r = compute_score(ScoreInputs(plan_features=PRO, items=[ItemState(90)],
                                      policies=[PolicyState(30, "تعارض المصالح", "CONFLICT_OF_INTEREST")]))
        texts = [x["text"] for x in r.as_dict()["reasons"]]
        self.assertIn("لم تُعتمد سياسة الخصوصية بعد", texts)
        self.assertLess(r.score, 100)

    def test_privacy_not_required_without_pdpl_feature(self):
        r = compute_score(ScoreInputs(plan_features=frozenset({"OPERATIONAL", "GOVERNANCE"}),
                                      policies=[PolicyState(30, "تعارض المصالح", "CONFLICT_OF_INTEREST")]))
        self.assertEqual(r.score, 100)

    def test_cap_reason_first(self):
        r = compute_score(ScoreInputs(plan_features=ESSENTIAL,
                                      items=[ItemState(200, "MEDIUM", "x")] * 20 + [ItemState(-1, "CRITICAL", "السجل التجاري")],
                                      audit_percentages=[100]))
        self.assertIn("محدود عند 50%", r.as_dict()["reasons"][0]["text"])

    def test_points_agreement(self):
        from haseef.domain.arabic import count_points
        self.assertEqual([count_points(n) for n in (1, 2, 3, 10, 11, 50)],
                         ["نقطة واحدة", "نقطتان", "3 نقاط", "10 نقاط", "11 نقطة", "50 نقطة"])
