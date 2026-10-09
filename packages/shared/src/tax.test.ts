import { test } from "node:test";
import assert from "node:assert/strict";
import { fiscalYears, taxPlan, vatDue, vatPeriods, whtDue, zakatDue } from "./tax.ts";
import { buildIcs } from "./ics.ts";

test("tax deadlines (same vectors as test_growth.py)", () => {
  assert.deepEqual(vatPeriods("2026-10-09", "QUARTERLY"), [["2026-07-01", "2026-09-30"], ["2026-10-01", "2026-12-31"]]);
  assert.deepEqual(vatPeriods("2026-01-05", "MONTHLY")[0], ["2025-12-01", "2025-12-31"]);
  assert.equal(vatDue("2026-09-30"), "2026-10-31");
  assert.equal(vatDue("2026-01-31"), "2026-02-28");
  assert.equal(whtDue("2026-09-30"), "2026-10-10");
  assert.equal(zakatDue("2025-12-31"), "2026-04-30");
  assert.deepEqual(fiscalYears("2026-10-09", 12), [["2025-01-01", "2025-12-31"], ["2026-01-01", "2026-12-31"]]);
  assert.deepEqual(fiscalYears("2026-10-09", 6)[0], ["2025-07-01", "2026-06-30"]);
  assert.deepEqual(taxPlan("2026-10-09", { vat_registered: true, vat_frequency: "QUARTERLY", withholding_applies: false, zakat_applies: true, fiscal_year_end_month: 12 }).map((t) => t.kind),
    ["VAT_RETURN", "VAT_RETURN", "ZAKAT_RETURN", "ZAKAT_RETURN"]);
});

test("ics hides employee names by default and folds lines", () => {
  const ev = [{ target_type: "IQAMA", target_id: "x", title: "انتهاء الإقامة — محمد", due_date: "2026-10-20" }];
  const out = buildIcs("ن", ev);
  assert.ok(out.includes("SUMMARY:انتهاء الإقامة — موظف"));
  assert.ok(out.includes("DTSTART;VALUE=DATE:20261020"));
  assert.ok(out.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75));
  assert.ok(buildIcs("ن", ev, true).includes("محمد"));
});
