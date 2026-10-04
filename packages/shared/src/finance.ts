/**
 * المالية الداخلية لحصيف: الفواتير الضريبية والمصروفات وضريبة القيمة المضافة.
 * مطابق لـ apps/api/haseef/domain/finance.py (يُختبر التطابق في finance.test.ts و test_finance.py).
 */

export const VAT_RATE = 0.15;

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** المبلغ قبل الضريبة ← الضريبة والإجمالي. */
export function vatFromNet(net: number, rate = VAT_RATE) {
  const vat = round2(net * rate);
  return { net: round2(net), vat, total: round2(net + vat) };
}
/** الإجمالي شامل الضريبة ← الصافي والضريبة. */
export function vatFromGross(total: number, rate = VAT_RATE) {
  const net = round2(total / (1 + rate));
  return { net, vat: round2(total - net), total: round2(total) };
}

/**
 * رمز QR للفاتورة الضريبية المبسطة (المرحلة الأولى من الفوترة الإلكترونية — هيئة الزكاة والضريبة والجمارك):
 * TLV بخمسة حقول: اسم البائع، الرقم الضريبي، وقت الإصدار، الإجمالي شامل الضريبة، مبلغ الضريبة؛ ثم Base64.
 */
export function zatcaTlv(f: { seller: string; vatNumber: string; timestamp: string; total: number; vat: number }): string {
  const enc = new TextEncoder();
  const parts = [f.seller, f.vatNumber, f.timestamp, f.total.toFixed(2), f.vat.toFixed(2)].map((v, i) => {
    const b = enc.encode(v);
    if (b.length > 255) throw new Error("حقل أطول من 255 بايت");
    return [i + 1, b.length, ...b];
  });
  const bytes = parts.flat();
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

/** فك TLV (للاختبار وعرض محتوى الرمز). */
export function parseZatcaTlv(b64: string): string[] {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const out: string[] = [];
  for (let i = 0; i < bytes.length;) {
    const len = bytes[i + 1];
    out.push(new TextDecoder().decode(bytes.slice(i + 2, i + 2 + len)));
    i += 2 + len;
  }
  return out;
}

export const EXPENSE_CATEGORY: Record<string, string> = {
  HOSTING: "الاستضافة والخوادم",
  AI: "الذكاء الاصطناعي",
  MESSAGING: "واتساب والبريد",
  PAYMENT_FEES: "رسوم بوابة الدفع",
  SALARIES: "الرواتب والتأمينات",
  LAWYER_FEES: "أتعاب المحامين (الاستشارات)",
  MARKETING: "التسويق",
  PROFESSIONAL: "المحاسبة والاستشارات المهنية",
  GOVERNMENT: "الرسوم الحكومية والتراخيص",
  SOFTWARE: "البرامج والأدوات",
  OFFICE: "المكتب ومساحة العمل",
  OTHER: "أخرى",
};
export const INVOICE_SOURCE: Record<string, string> = {
  SUBSCRIPTION: "اشتراك",
  CONSULTATION: "استشارة قانونية",
  MANUAL: "يدوية",
};
export const INVOICE_KIND: Record<string, string> = { INVOICE: "فاتورة ضريبية", CREDIT_NOTE: "إشعار دائن" };
export const INVOICE_STATUS: Record<string, string> = { ISSUED: "صادرة", VOID: "ملغاة بإشعار دائن" };

export interface InvoiceLine { description: string; quantity: number; unit_price: number; net: number; vat: number; total: number }

/** سطر فاتورة من كمية وسعر وحدة قبل الضريبة. */
export function invoiceLine(description: string, quantity: number, unitPrice: number, rate = VAT_RATE): InvoiceLine {
  const v = vatFromNet(quantity * unitPrice, rate);
  return { description, quantity, unit_price: round2(unitPrice), net: v.net, vat: v.vat, total: v.total };
}

/** رقم الفاتورة: HSF-2026-000123 والإشعار الدائن CN-2026-000007. */
export function invoiceNumber(kind: "INVOICE" | "CREDIT_NOTE", year: number, seq: number): string {
  return `${kind === "INVOICE" ? "HSF" : "CN"}-${year}-${String(seq).padStart(6, "0")}`;
}

/** ربع السنة الضريبي (1..4) لتاريخ ISO. */
export const quarterOf = (iso: string) => Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1;

/** حدود فترة: شهر (2026-10) أو ربع (2026-Q4) أو سنة (2026) ← [من، إلى) بصيغة YYYY-MM-DD. */
export function periodRange(p: string): { from: string; to: string; label: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  let m: RegExpMatchArray | null;
  if ((m = p.match(/^(\d{4})-(\d{2})$/))) {
    const y = +m[1], mo = +m[2];
    return { from: `${y}-${pad(mo)}-01`, to: mo === 12 ? `${y + 1}-01-01` : `${y}-${pad(mo + 1)}-01`, label: `${y}/${pad(mo)}` };
  }
  if ((m = p.match(/^(\d{4})-Q([1-4])$/))) {
    const y = +m[1], q = +m[2], s = (q - 1) * 3 + 1;
    return { from: `${y}-${pad(s)}-01`, to: q === 4 ? `${y + 1}-01-01` : `${y}-${pad(s + 3)}-01`, label: `الربع ${q} — ${y}` };
  }
  if ((m = p.match(/^(\d{4})$/))) return { from: `${m[1]}-01-01`, to: `${+m[1] + 1}-01-01`, label: `سنة ${m[1]}` };
  throw new Error("فترة غير صحيحة");
}

export const sar = (n: number | null | undefined) =>
  n == null ? "—" : `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ريال`;
