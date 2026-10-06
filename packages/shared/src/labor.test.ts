import { test } from "node:test";
import assert from "node:assert/strict";
import { GOSI_RATES, contribution, gosiLatePenalty, parseEmployeesCsv, periodsToPlan, pickRate, qiwaIndicators, taskDueDate, wpsFine } from "./labor.ts";

const rate = (s: string, on: string) => { const r = pickRate(GOSI_RATES, s, on); assert.ok(r); return r!; };

test("GOSI contributions (same vectors as test_labor.py)", () => {
  assert.deepEqual(contribution(8000, 2000, rate("OLD", "2026-10-01")), { base: 10000, employee: 975, employer: 1175, total: 2150, employee_pct: 9.75, employer_pct: 11.75 });
  const n = contribution(8000, 2000, rate("NEW", "2026-10-01"));
  assert.equal(n.employee, 1075); assert.equal(n.employer, 1275);
  assert.equal(rate("NEW", "2026-06-30").employee_annuity, 9.5);
  assert.equal(rate("NEW", "2028-08-01").employee_annuity, 11);
  const f = contribution(3000, 750, rate("NON_SAUDI", "2026-10-01"));
  assert.equal(f.employee, 0); assert.equal(f.employer, 75);
  assert.equal(contribution(1000, 0, rate("OLD", "2026-10-01")).base, 1500);
  assert.equal(contribution(60000, 0, rate("OLD", "2026-10-01")).base, 45000);
});

test("monthly due dates", () => {
  assert.equal(taskDueDate("GOSI_PAYMENT", "2026-09-01"), "2026-10-15");
  assert.equal(taskDueDate("WPS_UPLOAD", "2026-09-01"), "2026-10-30");
  assert.equal(taskDueDate("SALARY_PAYMENT", "2026-09-01", 27), "2026-09-27");
  assert.equal(taskDueDate("WPS_UPLOAD", "2026-02-01"), "2026-03-30");
  assert.equal(taskDueDate("GOSI_PAYMENT", "2026-12-01"), "2027-01-15");
  assert.deepEqual(periodsToPlan("2026-01-10"), ["2025-12-01", "2026-01-01"]);
});

test("penalties and indicators", () => {
  assert.equal(gosiLatePenalty(2150, "2026-10-15", "2026-10-15"), 0);
  assert.equal(gosiLatePenalty(2150, "2026-10-15", "2026-10-16"), 43);
  assert.equal(gosiLatePenalty(2150, "2026-10-15", "2026-11-20"), 86);
  assert.deepEqual([wpsFine(5), wpsFine(21), wpsFine(50)], [500, 1000, 2000]);
  const q = qiwaIndicators([
    { nationality: "SAUDI", qiwa_contract_documented: true, gosi_registered: true },
    { nationality: "NON_SAUDI", qiwa_contract_documented: false, gosi_registered: true },
    { nationality: "NON_SAUDI", qiwa_contract_documented: true, gosi_registered: false, is_active: false },
  ]);
  assert.equal(q.employees, 2); assert.equal(q.saudization_pct, 50); assert.equal(q.documented_pct, 50);
});

test("CSV import", () => {
  const { rows, errors } = parseEmployeesCsv("الاسم,الجنسية,الراتب الأساسي,بدل السكن,انتهاء الإقامة,موثق في قوى\nسارة,سعودية,9000,2250,2027-01-01,نعم\nرفيق,هندي,3000,750,2027-02-01,لا\n,سعودي,1,1,,\n");
  assert.equal(rows.length, 2); assert.equal(errors.length, 1);
  assert.equal(rows[0].nationality, "SAUDI"); assert.equal(rows[0].iqama_expiry, null); assert.equal(rows[0].qiwa_contract_documented, true);
  assert.equal(rows[1].nationality, "NON_SAUDI"); assert.equal(rows[1].iqama_expiry, "2027-02-01");
});
