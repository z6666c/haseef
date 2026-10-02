import { test } from "node:test";
import assert from "node:assert/strict";
import CONTENT from "./demo-content.json" with { type: "json" };
import { dpiaAssess } from "./dpia.ts";
import type { DpiaMitigation, DpiaQuestion } from "./api.ts";

test("DPIA TS port matches Python", () => {
  const qs = CONTENT.dpia.questions as DpiaQuestion[];
  for (const c of CONTENT.dpia.cases) {
    assert.deepEqual(dpiaAssess(qs, c.answers as Record<string, boolean>, c.mitigations as DpiaMitigation[]), c.expected);
  }
});
