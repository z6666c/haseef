import json
import unittest

from haseef.ai.validation import InvalidModelOutput, validate_audit_output

IDS = {"art-83", "art-53"}
MAP = {"[NATIONAL_ID_1]": "1023456789"}


def out(findings, pct=70, fenced=False):
    body = json.dumps({"document_type": "LABOR_CONTRACT", "compliance_percentage": pct, "findings": findings},
                      ensure_ascii=False)
    return f"إليك النتيجة:\n```json\n{body}\n```" if fenced else body


class ValidationTests(unittest.TestCase):
    def test_keeps_grounded_violation(self):
        r = validate_audit_output(out([{"severity": "VIOLATION", "violated_law_id": "art-83",
                                        "clause_title": "عدم المنافسة"}]), retrieved_ids=IDS, pii_mapping={})
        self.assertEqual(r.violations_count, 1)
        self.assertEqual(r.verdict, "CONTAINS_VIOLATIONS")
        self.assertEqual(r.findings[0]["violated_law_id"], "art-83")

    def test_hallucinated_article_downgraded(self):
        r = validate_audit_output(out([{"severity": "VIOLATION", "violated_law_id": "art-999"}]),
                                  retrieved_ids=IDS, pii_mapping={})
        self.assertEqual(r.violations_count, 0)
        self.assertEqual(r.findings[0]["severity"], "WARNING")
        self.assertIsNone(r.findings[0]["violated_law_id"])
        self.assertEqual(r.dropped_citations, ["art-999"])

    def test_violation_without_law_becomes_warning(self):
        r = validate_audit_output(out([{"severity": "VIOLATION", "violated_law_id": None}]),
                                  retrieved_ids=IDS, pii_mapping={})
        self.assertEqual(r.findings[0]["severity"], "WARNING")

    def test_pii_restored_in_display_text(self):
        r = validate_audit_output(out([{"severity": "WARNING", "violated_law_id": None,
                                        "clause_extracted_text": "الموظف صاحب الهوية [NATIONAL_ID_1]"}]),
                                  retrieved_ids=IDS, pii_mapping=MAP)
        self.assertIn("1023456789", r.findings[0]["clause_extracted_text"])

    def test_counts_computed_not_trusted(self):
        raw = json.dumps({"compliance_percentage": 90, "violations_count": 0, "findings": [
            {"severity": "VIOLATION", "violated_law_id": "art-83"},
            {"severity": "VIOLATION", "violated_law_id": "art-53"},
        ]})
        self.assertEqual(validate_audit_output(raw, retrieved_ids=IDS, pii_mapping={}).violations_count, 2)

    def test_high_risk_verdict(self):
        r = validate_audit_output(out([{"severity": "VIOLATION", "violated_law_id": "art-83"}], pct=30),
                                  retrieved_ids=IDS, pii_mapping={})
        self.assertEqual(r.verdict, "HIGH_RISK")

    def test_fenced_json_and_clamp(self):
        r = validate_audit_output(out([], pct=150, fenced=True), retrieved_ids=IDS, pii_mapping={})
        self.assertEqual(r.compliance_percentage, 100)
        self.assertEqual(r.verdict, "COMPLIANT")

    def test_garbage_rejected(self):
        with self.assertRaises(InvalidModelOutput):
            validate_audit_output("لا أستطيع المساعدة", retrieved_ids=IDS, pii_mapping={})
        with self.assertRaises(InvalidModelOutput):
            validate_audit_output('{"findings": "none"}', retrieved_ids=IDS, pii_mapping={})

    def test_disclaimer_always_present(self):
        r = validate_audit_output(out([]), retrieved_ids=IDS, pii_mapping={})
        self.assertIn("لا يُغني عن الاستشارة القانونية", r.disclaimer)


if __name__ == "__main__":
    unittest.main()
