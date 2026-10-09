import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_POLICIES, annualEntitlement, countLeaveDays, dailyWage, holidayDates, lateAmount, lateReturnDays, resolvePaid, sickNote, sickSplit, validateDeduction, validateLeave } from "./hr.ts";

const WD = [0, 1, 2, 3, 4];

test("الاستحقاق والأيام", () => {
  assert.equal(annualEntitlement("2022-06-01", "2027-05-31"), 21);
  assert.equal(annualEntitlement("2022-06-01", "2027-06-01"), 30);
  const hol = holidayDates([{ event_date: "2027-09-23", is_holiday: true, holiday_days: 1 }]);
  assert.equal(countLeaveDays("2027-09-19", "2027-09-25", { workDays: WD, holidays: hol, workdaysOnly: true }), 4);
  assert.equal(countLeaveDays("2027-09-19", "2027-09-25", { workDays: WD, holidays: hol, workdaysOnly: false }), 7);
  assert.equal(lateReturnDays("2027-01-07", "2027-01-12", WD, new Set()), 2);
  assert.equal(lateReturnDays("2027-01-07", "2027-01-10", WD, new Set()), 0);
});

test("التحقق من الإجازة — مطابق للخادم", () => {
  const base = { leaveType: "ANNUAL" as const, start: "2027-01-10", end: "2027-01-14", days: 5, today: "2027-01-01", policy: DEFAULT_POLICIES.ANNUAL, byHr: false, balance: 21, usedThisYearType: 0 };
  assert.equal(validateLeave(base), null);
  assert.match(validateLeave({ ...base, balance: 3 })!, /الرصيد/);
  assert.match(validateLeave({ ...base, start: "2026-12-30" })!, /مضى/);
  assert.match(validateLeave({ ...base, leaveType: "EMERGENCY", policy: DEFAULT_POLICIES.EMERGENCY, days: 4 })!, /الحد الأقصى/);
  const sick = { ...base, leaveType: "SICK" as const, policy: DEFAULT_POLICIES.SICK, today: "2027-01-05", end: "2027-01-02", days: 2, balance: 0 };
  assert.equal(validateLeave({ ...sick, start: "2026-12-30" }), null);
  assert.match(validateLeave({ ...sick, start: "2026-12-20" })!, /المرضية/);
});

test("شرائح الإجازة المرضية (المادة 117)", () => {
  assert.deepEqual(sickSplit(25, 10), [[5, 1], [5, 0.75]]);
  assert.deepEqual(sickSplit(85, 10), [[5, 0.75], [5, 0]]);
  assert.equal(sickNote(25, 10), "5 يوم بأجر كامل، 5 يوم بثلاثة أرباع الأجر");
});

test("سقوف الخصم", () => {
  assert.equal(dailyWage(7000, 2000), 300);
  assert.equal(lateAmount(48, 300, 480), 30);
  const b = { kind: "LATE" as const, amount: 100, incident: "2027-01-10", today: "2027-01-15", dwage: 300, monthlyWage: 9000, monthFines: 0, monthTotal: 0 };
  assert.equal(validateDeduction(b), null);
  assert.match(validateDeduction({ ...b, amount: 1501 })!, /خمسة أيام/);
  assert.match(validateDeduction({ ...b, incident: "2026-12-01" })!, /30 يوماً/);
  assert.equal(validateDeduction({ ...b, kind: "ABSENCE", amount: 3000, incident: "2026-12-01" }), null);
  assert.match(validateDeduction({ ...b, kind: "ABSENCE", amount: 3000, monthTotal: 2000 })!, /نصف الأجر/);
});

test("أجر الاعتيادية والاضطرارية باختيار الموظف", () => {
  const reg = DEFAULT_POLICIES.REGULAR;
  assert.equal(resolvePaid(reg, null), true);
  assert.equal(resolvePaid(reg, false), false);
  assert.equal(resolvePaid(DEFAULT_POLICIES.ANNUAL, false), true);
  const base = { leaveType: "REGULAR" as const, start: "2027-01-10", end: "2027-01-11", days: 2, today: "2027-01-01", policy: reg, byHr: false, usedThisYearType: 0 };
  assert.match(validateLeave({ ...base, balance: 1, isPaid: true }) ?? "", /الرصيد/);
  assert.equal(validateLeave({ ...base, balance: 0, isPaid: false }), null);
});

