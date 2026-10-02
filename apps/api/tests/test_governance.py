import unittest
from datetime import date

from haseef.content.library import GUIDES, LAWS, TEMPLATES
from haseef.content.obligations import OBLIGATIONS, applies_to
from haseef.content.standards import STANDARDS, STRUCTURE_TEMPLATES
from haseef.domain.governance_check import Body, Member, OrgContext, run_check
from haseef.domain.score import ItemState, PolicyState, ScoreInputs, compute_score

TODAY = date(2026, 10, 2)
PRO = frozenset({"OPERATIONAL", "CONTRACTS", "GOVERNANCE", "PDPL"})


def std(**over):
    """المعايير كما تُخزَّن في قاعدة البيانات."""
    return [{**s, "applies_legal_types": s["applies"]} for s in STANDARDS if all(s.get(k) == v for k, v in over.items())]


def ctx(legal="CLOSED_JOINT_STOCK", bodies=None, profile=None, policies=(), ropa=0, doa=0, size="MEDIUM"):
    return OrgContext(legal_type=legal, size=size, profile={"processes_personal_data": True, **(profile or {})},
                      bodies=bodies or [], active_policy_types=set(policies), ropa_count=ropa, doa_count=doa, today=TODAY)


def by_code(results):
    return {r.code: r for r in results}


class ContentTests(unittest.TestCase):
    def test_codes_unique(self):
        for coll, key in ((STANDARDS, "code"), (OBLIGATIONS, "code"), (TEMPLATES + GUIDES + LAWS, "slug")):
            keys = [x[key] for x in coll]
            self.assertEqual(len(keys), len(set(keys)), key)

    def test_every_legal_type_has_template(self):
        for lt in ("LLC", "SOLE_PROPRIETORSHIP", "CLOSED_JOINT_STOCK", "SIMPLIFIED_JOINT_STOCK",
                   "PUBLIC_JOINT_STOCK", "BRANCH_OF_FOREIGN"):
            self.assertTrue(STRUCTURE_TEMPLATES[lt], lt)

    def test_templates_have_policy_type_and_body(self):
        for t in TEMPLATES:
            self.assertTrue(t["body"].startswith("#"), t["slug"])
        self.assertGreaterEqual(sum(1 for t in TEMPLATES if t["policy_type"]), 12)

    def test_laws_are_https(self):
        for law in LAWS:
            self.assertTrue(law["url"].startswith("https://"), law["slug"])

    def test_known_check_kinds(self):
        kinds = {"body_exists", "body_or_position", "board_min_members", "has_position", "independent_min",
                 "majority_non_exec", "chair_non_exec", "committee", "terms_valid", "profile_field",
                 "profile_recent", "policy_active", "ropa_exists", "doa_exists"}
        for s in STANDARDS:
            self.assertIn(s["rule"]["check"], kinds, s["code"])


class PdplContentTests(unittest.TestCase):
    def test_ropa_templates_valid(self):
        from haseef.content.pdpl import ROPA_TEMPLATES
        for t in ROPA_TEMPLATES:
            self.assertIn(t["data_subjects"], {"EMPLOYEES", "CUSTOMERS", "VENDORS", "APPLICANTS", "VISITORS", "OTHER"})
            self.assertIn(t["legal_basis"], {"CONSENT", "CONTRACTUAL", "LEGAL_OBLIGATION", "VITAL_INTEREST", "PUBLIC_INTEREST", "LEGITIMATE_INTEREST"})
            self.assertIn(t["storage_location"], {"SAUDI_LOCAL_CLOUD", "ON_PREMISE", "FOREIGN_CLOUD"})
            if t.get("cross_border_transfer"):
                self.assertTrue(t["transfer_destination"] and t["transfer_safeguard"])


class CheckTests(unittest.TestCase):
    def test_sole_proprietorship_ignores_jsc_rules(self):
        results, _ = run_check(std(), ctx(legal="SOLE_PROPRIETORSHIP"))
        codes = by_code(results)
        self.assertNotIn("JSC_BOARD_MIN3", codes)
        self.assertNotIn("STR_BYLAWS", codes)
        self.assertIn("STR_MANAGEMENT_DEFINED", codes)

    def test_board_min_three(self):
        board = Body("BOARD", "المجلس", [Member("أ"), Member("ب")])
        r = by_code(run_check(std(code="JSC_BOARD_MIN3"), ctx(bodies=[board]))[0])["JSC_BOARD_MIN3"]
        self.assertEqual(r.status, "FAIL")
        board.members.append(Member("ج"))
        r = by_code(run_check(std(code="JSC_BOARD_MIN3"), ctx(bodies=[board]))[0])["JSC_BOARD_MIN3"]
        self.assertEqual(r.status, "PASS")

    def test_independents_two_or_third(self):
        members = [Member(str(i), is_independent=i < 2) for i in range(9)]   # 9 أعضاء: المطلوب 3
        board = Body("BOARD", "المجلس", members)
        r = by_code(run_check(std(code="PJSC_INDEPENDENTS"), ctx("PUBLIC_JOINT_STOCK", [board]))[0])["PJSC_INDEPENDENTS"]
        self.assertEqual(r.status, "FAIL")
        members[2].is_independent = True
        r = by_code(run_check(std(code="PJSC_INDEPENDENTS"), ctx("PUBLIC_JOINT_STOCK", [board]))[0])["PJSC_INDEPENDENTS"]
        self.assertEqual(r.status, "PASS")

    def test_independents_small_board_needs_two(self):
        board = Body("BOARD", "المجلس", [Member("أ", is_independent=True), Member("ب"), Member("ج")])
        r = by_code(run_check(std(code="PJSC_INDEPENDENTS"), ctx("PUBLIC_JOINT_STOCK", [board]))[0])["PJSC_INDEPENDENTS"]
        self.assertEqual(r.status, "FAIL")

    def test_audit_committee_rejects_executive(self):
        c = Body("AUDIT_COMMITTEE", "لجنة المراجعة", [Member("أ"), Member("ب"), Member("ج", is_executive=True)])
        r = by_code(run_check(std(code="JSC_AUDIT_COMMITTEE"), ctx(bodies=[c]))[0])["JSC_AUDIT_COMMITTEE"]
        self.assertEqual(r.status, "FAIL")

    def test_chair_not_executive(self):
        board = Body("BOARD", "المجلس", [Member("أ", position="CHAIR", is_executive=True)])
        r = by_code(run_check(std(code="PJSC_CHAIR_NONEXEC"), ctx("PUBLIC_JOINT_STOCK", [board]))[0])["PJSC_CHAIR_NONEXEC"]
        self.assertEqual(r.status, "FAIL")

    def test_expired_term(self):
        board = Body("BOARD", "المجلس", [Member("سالم", term_ends_on=date(2026, 1, 1))])
        r = by_code(run_check(std(code="STR_TERMS_VALID"), ctx(bodies=[board]))[0])["STR_TERMS_VALID"]
        self.assertEqual(r.status, "FAIL")
        self.assertIn("سالم", r.message)

    def test_small_llc_exempt_from_auditor(self):
        r = by_code(run_check(std(code="LLC_AUDITOR"), ctx("LLC", size="SMALL"))[0])["LLC_AUDITOR"]
        self.assertEqual(r.status, "NA")
        r = by_code(run_check(std(code="LLC_AUDITOR"), ctx("LLC", size="MEDIUM"))[0])["LLC_AUDITOR"]
        self.assertEqual(r.status, "FAIL")

    def test_assembly_recency(self):
        r = by_code(run_check(std(code="JSC_ANNUAL_ASSEMBLY"), ctx(profile={"last_assembly_on": date(2025, 12, 1)}))[0])
        self.assertEqual(r["JSC_ANNUAL_ASSEMBLY"].status, "PASS")
        r = by_code(run_check(std(code="JSC_ANNUAL_ASSEMBLY"), ctx(profile={"last_assembly_on": date(2024, 3, 1)}))[0])
        self.assertEqual(r["JSC_ANNUAL_ASSEMBLY"].status, "FAIL")

    def test_pdpl_na_without_personal_data(self):
        r = by_code(run_check(std(code="PDPL_PRIVACY_POLICY"), ctx(profile={"processes_personal_data": False}))[0])
        self.assertEqual(r["PDPL_PRIVACY_POLICY"].status, "NA")

    def test_score_counts_only_mandatory_weighted(self):
        # إلزامي حرج ناجح (3) + إلزامي عالٍ فاشل (2) + استرشادي فاشل (لا يُحتسب) = 3/5 = 60
        stds = [
            {"code": "A", "domain": "BOARD", "level": "MANDATORY", "severity": "critical", "title": "أ", "applies_legal_types": [],
             "rule": {"check": "doa_exists"}},
            {"code": "B", "domain": "BOARD", "level": "MANDATORY", "severity": "high", "title": "ب", "applies_legal_types": [],
             "rule": {"check": "ropa_exists"}},
            {"code": "C", "domain": "BOARD", "level": "RECOMMENDED", "severity": "medium", "title": "ج", "applies_legal_types": [],
             "rule": {"check": "policy_active", "policy_type": "X"}},
        ]
        _, score = run_check(stds, ctx(doa=1))
        self.assertEqual(score, 60.0)

    def test_full_template_structure_passes_structural_rules(self):
        """هيكل مساهمة مقفلة مكتمل يجتاز معايير الهيكل والمجلس واللجان."""
        board = Body("BOARD", "المجلس", [Member("أ", position="CHAIR"), Member("ب", position="SECRETARY"), Member("ج")])
        audit = Body("AUDIT_COMMITTEE", "لجنة المراجعة", [Member("د"), Member("هـ"), Member("و")])
        results, _ = run_check(std(domain="BOARD") + std(code="JSC_AUDIT_COMMITTEE"), ctx(bodies=[board, audit]))
        failed = [r.code for r in results if r.status == "FAIL" and r.level == "MANDATORY"]
        self.assertEqual(failed, [])


class ApplicabilityTests(unittest.TestCase):
    ORG = {"legal_type": "LLC", "employees_count": 5, "processes_personal_data": True, "vat_registered": None, "industry": "المقاولات"}

    def test_work_regulation_needs_ten(self):
        rule = next(o for o in OBLIGATIONS if o["code"] == "WORK_REGULATION")["applies"]
        self.assertEqual(applies_to(rule, self.ORG), (False, False))
        self.assertEqual(applies_to(rule, {**self.ORG, "employees_count": 12}), (True, False))
        self.assertEqual(applies_to(rule, {**self.ORG, "employees_count": None}), (True, True))

    def test_vat_unknown_is_flagged(self):
        rule = next(o for o in OBLIGATIONS if o["code"] == "VAT_RETURNS")["applies"]
        self.assertEqual(applies_to(rule, self.ORG), (True, True))
        self.assertEqual(applies_to(rule, {**self.ORG, "vat_registered": False}), (False, False))

    def test_legal_type_filter(self):
        rule = next(o for o in OBLIGATIONS if o["code"] == "GOV_BOARD_CHARTER")["applies"]
        self.assertFalse(applies_to(rule, self.ORG)[0])
        self.assertTrue(applies_to(rule, {**self.ORG, "legal_type": "CLOSED_JOINT_STOCK"})[0])

    def test_aml_by_industry(self):
        rule = next(o for o in OBLIGATIONS if o["code"] == "AML_PROGRAM")["applies"]
        self.assertFalse(applies_to(rule, self.ORG)[0])
        self.assertTrue(applies_to(rule, {**self.ORG, "industry": "الوساطة العقارية"})[0])


class ScoreStructureTests(unittest.TestCase):
    def test_structure_part_and_reasons(self):
        base = ScoreInputs(plan_features=PRO, items=[ItemState(200)],
                           policies=[PolicyState(100, policy_type="PRIVACY_POLICY")])
        without = compute_score(base)
        with_struct = compute_score(ScoreInputs(**{**base.__dict__, "structure_score": 50.0,
                                                   "structure_failures": [("لجنة المراجعة", "high")]}))
        self.assertLess(with_struct.score, without.score)
        self.assertTrue(any("لجنة المراجعة" in r.text for r in with_struct.reasons))
        # الخصم المعروض يطابق الفرق فعلاً
        loss = sum(r.points for r in with_struct.reasons if "معيار حوكمة" in r.text)
        self.assertAlmostEqual(loss, without.score - with_struct.score, delta=1)


if __name__ == "__main__":
    unittest.main()
