import { test } from "node:test";
import assert from "node:assert/strict";
import { invoiceLine, invoiceNumber, parseZatcaTlv, periodRange, vatFromGross, vatFromNet, zatcaTlv } from "./finance.ts";
import { qrMatrix } from "./qr.ts";

test("ضريبة القيمة المضافة", () => {
  assert.deepEqual(vatFromNet(199), { net: 199, vat: 29.85, total: 228.85 });
  assert.deepEqual(vatFromGross(573.85), { net: 499, vat: 74.85, total: 573.85 });
  assert.equal(invoiceLine("x", 1, 4990).total, 5738.5);
});

test("رمز الفاتورة TLV يطابق الخادم", () => {
  const b64 = zatcaTlv({ seller: "حصيف", vatNumber: "300000000000003", timestamp: "2026-10-04T12:00:00Z", total: 228.85, vat: 29.85 });
  assert.deepEqual(parseZatcaTlv(b64), ["حصيف", "300000000000003", "2026-10-04T12:00:00Z", "228.85", "29.85"]);
  // نفس الناتج في apps/api/tests/test_finance.py
  assert.equal(b64.slice(0, 4), "AQjY");
});

test("ترقيم وفترات", () => {
  assert.equal(invoiceNumber("INVOICE", 2026, 12), "HSF-2026-000012");
  assert.deepEqual(periodRange("2026-Q4"), { from: "2026-10-01", to: "2027-01-01", label: "الربع 4 — 2026" });
  assert.deepEqual(periodRange("2026-12").to, "2027-01-01");
});

test("رمز QR يتسع لفاتورة كاملة", () => {
  const b64 = zatcaTlv({ seller: "حصيف لتقنية المعلومات", vatNumber: "300000000000003", timestamp: "2026-10-04T12:00:00Z", total: 14938.5, vat: 1948.5 });
  const m = qrMatrix(b64);
  assert.ok(m.length >= 21 && m.length <= 97);
});
