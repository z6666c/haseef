import { test } from "node:test";
import assert from "node:assert/strict";
import { absenceBracket, lateBracket, suggestPenalty } from "./penalties.ts";
import { dailyWage, validateDeduction } from "./hr.ts";

test("شرائح وتدرج جدول اللائحة (مطابق للخادم)", () => {
  assert.equal(lateBracket(10), "LATE_15");
  assert.equal(lateBracket(61), "LATE_OVER");
  assert.equal(absenceBracket(9), "ABS_7_10");
  assert.equal(suggestPenalty("LATE_15", 1, 300).nature, "WARNING");
  const s2 = suggestPenalty("LATE_15", 2, 300);
  assert.deepEqual([s2.nature, s2.amount, s2.label], ["PENALTY", 15, "حسم 5% من الأجر اليومي"]);
  assert.equal(suggestPenalty("LATE_15", 2, 300, true).amount, 45);
  assert.equal(suggestPenalty("LATE_30", 9, 300).amount, 150);
  assert.equal(suggestPenalty("ABS_1", 3, 300).label, "حسم أجر 4 أيام");
  assert.equal(suggestPenalty("ABS_15", 1, 300).nature, "ACTION");
});

test("طبيعة الإشعار وأجر اليوم", () => {
  const b = { kind: "LATE" as const, amount: 2000, incident: "2027-01-10", today: "2027-01-15", dwage: 300, monthlyWage: 9000, monthFines: 1500, monthTotal: 0 };
  assert.equal(validateDeduction({ ...b, nature: "WAGE" }), null);
  assert.equal(validateDeduction({ ...b, nature: "WARNING", amount: 0 }), null);
  assert.equal(dailyWage(6000, 1500, 1500), 300);
  assert.equal(dailyWage(6000, 1500, 1500, "BASIC_HOUSING"), 250);
});
