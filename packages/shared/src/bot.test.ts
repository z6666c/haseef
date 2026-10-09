import { test } from "node:test";
import assert from "node:assert/strict";
import { botHandle, botTokens, type BotPolicy } from "./bot.ts";

const POL: BotPolicy[] = [
  { id: "p1", title: "سياسة الإجازات", version: "1.0", body: "# الإجازة السنوية\nيستحق الموظف إجازة سنوية مدتها 21 يوماً، وتصبح 30 يوماً بعد خمس سنوات.\n\n# الإجازة المرضية\nتُقدَّم الإجازة المرضية بتقرير طبي معتمد خلال يومين." },
  { id: "p2", title: "سياسة الحضور والانصراف", version: "2.0", body: "ساعات العمل من 8 صباحاً إلى 4 مساءً، ويُسمح بتأخير 15 دقيقة." },
];
const FAQ: [string, string, string][] = [["f1", "كيف أطلب إجازة؟", "من تطبيق الموارد البشرية قبل أسبوعين."], ["f2", "متى تصرف الرواتب؟", "يوم 27 من كل شهر."]];
// نفس الحالات في apps/api/tests/test_growth.py
const CASES: [string, string, string | null][] = [["كم مدة الإجازة السنوية؟", "ANSWER", "p1"], ["متى يبدأ الدوام", "ANSWER", "p2"], ["كم دقيقة التأخير المسموح", "ANSWER", "p2"],
  ["كم راتب أحمد؟", "SENSITIVE", null], ["وش لون السماء", "NO_ANSWER", null], ["السياسات", "POLICIES", null], ["سياسة 1", "POLICY", null],
  ["أقر 2", "ACK", null], ["كيف اطلب اجازه", "ANSWER", "f1"], ["مساعدة", "MENU", null], ["سياسة 9", "POLICY_BAD", null], ["متى تصرف الرواتب", "ANSWER", "f2"], ["كم راتب سارة", "SENSITIVE", null]];

test("bot cases match the server engine", () => {
  const st = { member_status: "ACTIVE" as const, member_name: "سارة", org_name: "النخبة", hr_contact: "hr@x.sa", policies: POL, faqs: FAQ };
  for (const [q, intent, src] of CASES) {
    const r = botHandle(q, st);
    assert.equal(r.intent, intent, q);
    if (src) assert.ok(r.sources[0].id.startsWith(`pol:${src}`) || r.sources[0].id.startsWith(`faq:${src}`), q);
  }
});

test("bot states and tokens", () => {
  assert.deepEqual(botHandle("موافق", { member_status: "INVITED", member_name: "سارة", org_name: "النخبة" }).action, { consent: true });
  assert.deepEqual(botHandle("انضمام abc123", { member_status: null, org_name: "النخبة" }, true).action, { join: "abc123" });
  assert.equal(botHandle("انضمام abc123", { member_status: null }).intent, "JOIN_BAD");
  assert.equal(botHandle("أقر 1", { member_status: "ACTIVE", policies: POL, faqs: FAQ, acknowledged: new Set(["p1"]) }).intent, "ACK_DUP");
  assert.equal(botHandle("كم مدة الإجازة السنوية؟", { member_status: "ACTIVE", policies: POL, faqs: FAQ, quota_left: 0 }).intent, "QUOTA");
  assert.deepEqual(botTokens("وتصبح بتأخير الإجازات"), ["تصبح", "تاخير", "اجاز"]);
});
