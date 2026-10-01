import { test } from "node:test";
import assert from "node:assert/strict";
import { countDays, duePhrase, expiryLine, formatDate } from "./format.ts";

// نفس حالات haseef/tests/test_alerts.py — الواجهة والواتساب يجب أن يتطابقا.
test("countDays agreement", () => {
  const cases: Record<number, string> = {
    1: "يوم واحد", 2: "يومين", 3: "3 أيام", 10: "10 أيام", 11: "11 يوماً",
    14: "14 يوماً", 60: "60 يوماً", 100: "100 يوم", 103: "103 أيام", 115: "115 يوماً",
  };
  for (const [n, s] of Object.entries(cases)) assert.equal(countDays(Number(n)), s);
});

test("duePhrase", () => {
  assert.equal(duePhrase(0), "اليوم");
  assert.equal(duePhrase(7), "خلال 7 أيام");
  assert.equal(duePhrase(-1), "منذ يوم واحد");
});

test("expiryLine", () => {
  assert.equal(expiryLine(5), "تنتهي خلال 5 أيام");
  assert.equal(expiryLine(0), "تنتهي اليوم");
  assert.equal(expiryLine(-2), "انتهت منذ يومين");
});

test("formatDate", () => assert.equal(formatDate("2026-10-02"), "02/10/2026"));

import { scoreTone } from "./format.ts";
test("scoreTone follows brand thresholds", () => {
  assert.equal(scoreTone(85), "good");
  assert.equal(scoreTone(84), "warn");
  assert.equal(scoreTone(50), "warn");
  assert.equal(scoreTone(49), "bad");
  assert.equal(scoreTone(null), "none");
});
