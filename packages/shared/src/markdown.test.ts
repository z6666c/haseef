import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown } from "./markdown.ts";

test("escapes raw html", () => {
  const out = renderMarkdown('<script>alert(1)</script> **x**');
  assert.ok(!out.includes("<script>"));
  assert.ok(out.includes("&lt;script&gt;"));
  assert.ok(out.includes("<strong>x</strong>"));
});

test("only https links", () => {
  assert.ok(renderMarkdown("[a](https://x.sa)").includes('href="https://x.sa"'));
  assert.ok(!renderMarkdown("[a](javascript:alert(1))").includes("href"));
});

test("headings, lists, tables", () => {
  const out = renderMarkdown("# عنوان\n\n- أ\n- ب\n\n1. واحد\n\n| أ | ب |\n|---|---|\n| 1 | 2 |");
  assert.ok(out.includes("<h2>عنوان</h2>"));
  assert.ok(out.includes("<ul><li>أ</li><li>ب</li></ul>"));
  assert.ok(out.includes("<ol><li>واحد</li></ol>"));
  assert.ok(out.includes("<th>أ</th>") && out.includes("<td>2</td>"));
});

test("slots highlighted", () => {
  assert.ok(renderMarkdown("«اسم المنشأة»").includes('class="md-slot"'));
});

test("blockquote and checkboxes", () => {
  const out = renderMarkdown("> ملاحظة\n\n- [ ] بند");
  assert.ok(out.includes("<blockquote>ملاحظة</blockquote>"));
  assert.ok(out.includes("<li>☐ بند</li>"));
});
