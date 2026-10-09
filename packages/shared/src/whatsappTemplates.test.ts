import { test } from "node:test";
import assert from "node:assert/strict";
import { WA_TEMPLATES, renderTemplate, templateFor, templateVars } from "./whatsappTemplates.ts";

test("template choice matches server", () => {
  assert.equal(templateFor("POLICY", 3), "haseef_policy_review_due");
  assert.equal(templateFor("COMPLIANCE_ITEM", 0), "haseef_license_expiring");
  assert.equal(templateFor("COMPLIANCE_ITEM", -2), "haseef_license_expired");
  assert.equal(templateFor("IQAMA", 14), "haseef_labor_due");
  assert.equal(templateFor("LABOR_TASK", -1), "haseef_labor_due");
  assert.equal(templateFor("TAX_TASK", 3), "haseef_tax_due");
});

test("all six variables are filled and none left", () => {
  const vars = templateVars({ recipient: "أحمد", title: "رخصة بلدي", orgName: "النخبة", dueDate: "2026-10-15", daysLeft: 7, link: "https://app.haseef.sa" });
  assert.deepEqual(vars.slice(3, 5), ["خلال 7 أيام", "15/10/2026"]);
  for (const k of Object.keys(WA_TEMPLATES) as (keyof typeof WA_TEMPLATES)[]) {
    const out = renderTemplate(k, vars);
    assert.ok(!/\{\{\d\}\}/.test(out), k);
    assert.ok(out.includes("أحمد") && (!WA_TEMPLATES[k].body.includes("{{3}}") || out.includes("النخبة")), k);
  }
});
