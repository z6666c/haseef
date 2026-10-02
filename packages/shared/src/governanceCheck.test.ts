import assert from "node:assert/strict";
import { test } from "node:test";
import CONTENT from "./demo-content.json" with { type: "json" };
import { runCheck, type CkStandard } from "./governanceCheck.ts";

test("TS check engine matches the Python engine on the demo structure", () => {
  const s = CONTENT.structure;
  const { results, score } = runCheck(CONTENT.admin_standards as unknown as CkStandard[], {
    legal_type: s.legal_type, size: s.size, profile: s.profile, bodies: s.bodies,
    active_policy_types: new Set(["CONFLICT_OF_INTEREST", "PRIVACY_POLICY"]), ropa_count: 0, doa_count: 0, today: CONTENT.check_today,
  });
  const py = s.latest_check;
  assert.equal(score, py.structure_score);
  assert.deepEqual(results.map((r) => [r.code, r.status, r.message]), py.results.map((r) => [r.code, r.status, r.message]));
});

test("examples exist for every legal type", () => {
  for (const lt of ["LLC", "SOLE_PROPRIETORSHIP", "SIMPLIFIED_JOINT_STOCK", "CLOSED_JOINT_STOCK", "PUBLIC_JOINT_STOCK", "BRANCH_OF_FOREIGN"]) {
    assert.ok(CONTENT.examples[lt as keyof typeof CONTENT.examples].bodies.length > 0, lt);
    assert.ok(CONTENT.templates[lt as keyof typeof CONTENT.templates].length > 0, lt);
  }
});

test("public JSC example passes all board/committee rules", () => {
  const ex = CONTENT.examples.PUBLIC_JOINT_STOCK;
  const { results } = runCheck(CONTENT.admin_standards as unknown as CkStandard[], {
    legal_type: "PUBLIC_JOINT_STOCK", size: "MEDIUM", profile: {}, bodies: ex.bodies,
    active_policy_types: new Set(), ropa_count: 0, doa_count: 0, today: CONTENT.check_today,
  });
  const fails = results.filter((r) => r.status === "FAIL" && ["BOARD", "AUDIT"].includes(r.domain) && r.code !== "JSC_AUDITOR").map((r) => r.code);
  assert.deepEqual(fails, []);
});
