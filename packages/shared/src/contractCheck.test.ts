import { test } from "node:test";
import assert from "node:assert/strict";
import { SAMPLE_CONTRACTS, checkContract, parseDurations, redactPii, wordsToNumbers } from "./contractCheck.ts";

const sample = (id: string) => SAMPLE_CONTRACTS.find((s) => s.id === id)!;
const ids = (id: string) => checkContract(sample(id).text, sample(id).kind).findings.map((f) => f.id).sort();

test("الأعداد المكتوبة بالحروف", () => {
  assert.equal(wordsToNumbers("خمسة عشر يوماً"), "15 يوماً");
  assert.equal(wordsToNumbers("واحد وعشرون يوماً"), "21 يوماً");
  assert.equal(wordsToNumbers("ثمان وأربعين ساعة"), "48 ساعة");
  assert.equal(wordsToNumbers("تسعون يوماً"), "90 يوماً");
});

test("المدد", () => {
  assert.deepEqual(parseDurations("ستة أشهر قابلة للتمديد ثلاثة أشهر").map((d) => d.days), [180, 90]);
  assert.deepEqual(parseDurations("لمدة سنتين").map((d) => d.unit), ["year"]);
  assert.deepEqual(parseDurations("لمدة سنة واحدة بعد انتهاء العقد").map((d) => d.days), [365]);
  assert.deepEqual(parseDurations("٩٠ يوماً").map((d) => d.days), [90]);
});

test("حجب البيانات الشخصية مطابق للخادم", () => {
  const r = redactPii("هوية 1098765432 جوال 0551234567 آيبان SA03 8000 0000 6080 1016 7519 بريد a@b.sa");
  assert.deepEqual(r.counts, { IBAN: 1, EMAIL: 1, PHONE: 1, NATIONAL_ID: 1 });
  assert.ok(!/1098765432|0551234567/.test(r.text));
});

test("العقد المخالف يُلتقط فيه كل بند", () => {
  assert.deepEqual(ids("labor-bad"), ["eos-waiver", "hours", "leave", "noncompete-scope", "noncompete-time", "overtime", "passport", "probation-max"]);
  assert.equal(checkContract(sample("labor-bad").text, "LABOR_CONTRACT").verdict, "HIGH_RISK");
});

test("العقد المتوافق بلا ملاحظات", () => {
  const r = checkContract(sample("labor-good").text, "LABOR_CONTRACT");
  assert.deepEqual(r.findings.map((f) => f.id), []);
  assert.equal(r.verdict, "COMPLIANT");
  assert.equal(r.percentage, 100);
});

test("سياسة الخصوصية الناقصة", () => {
  assert.deepEqual(ids("privacy-weak"), ["consent", "privacy-required", "sharing", "transfer"]);
});
