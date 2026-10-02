import unittest

from haseef.domain import dpia as dp


class Dpia(unittest.TestCase):
    def test_empty_is_low_not_required(self):
        a = dp.assess({})
        self.assertEqual((a.score, a.level, a.required), (0, "LOW", False))

    def test_all_yes_is_critical(self):
        a = dp.assess({k: True for k in dp.KEYS})
        self.assertEqual((a.score, a.level), (100, "CRITICAL"))
        self.assertTrue(a.required)

    def test_trigger_makes_required(self):
        a = dp.assess({"sensitive": True})
        self.assertTrue(a.required)
        self.assertEqual(a.triggers, ["sensitive"])
        self.assertFalse(dp.assess({"new_tech": True}).required)

    def test_mitigations_reduce_residual_only_when_done(self):
        ans = {"sensitive": True, "cross_border": True, "weak_security": True}
        mits = dp.suggested_mitigations(ans)
        self.assertEqual(len(mits), 3)
        before = dp.assess(ans, mits)
        self.assertEqual(before.residual_score, before.score)
        for m in mits:
            m["status"] = "DONE"
        after = dp.assess(ans, mits)
        self.assertLess(after.residual_score, before.score)
        self.assertEqual(after.open_mitigations, 0)

    def test_unknown_key_rejected(self):
        with self.assertRaises(ValueError):
            dp.assess({"nope": True})

    def test_levels(self):
        self.assertEqual([dp.level_for(x) for x in (0, 20, 40, 60)], ["LOW", "MEDIUM", "HIGH", "CRITICAL"])


if __name__ == "__main__":
    unittest.main()
