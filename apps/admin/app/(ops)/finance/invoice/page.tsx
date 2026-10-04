"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { INVOICE_SOURCE, parseZatcaTlv, qrSvg, sar, type Invoice } from "@haseef/shared";
import { ReasonDialog, useCan } from "@/components/ui";
import { api } from "@/lib/session";

const fmt = (iso: string) => new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Riyadh" }).format(new Date(iso));

function InvoiceView() {
  const id = useSearchParams().get("id");
  const can = useCan();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const load = useCallback(() => { if (id) api.admin.invoice(id).then(setInv).catch((e: Error) => setError(e.message)); }, [id]);
  useEffect(load, [load]);
  if (!id) return <p className="error">رقم الفاتورة غير محدد.</p>;
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!inv) return null;

  const s = inv.seller;
  const taxInvoice = inv.vat_amount > 0 || !!inv.qr;
  const title = inv.kind === "CREDIT_NOTE" ? "إشعار دائن" : taxInvoice ? "فاتورة ضريبية" : "فاتورة";
  const qr = inv.qr ? qrSvg(inv.qr, 3) : null;

  return (
    <>
      <div className="head-row no-print">
        <p className="crumbs"><Link href="/finance?tab=invoices">المالية / الفواتير</Link> / <bdi dir="ltr">{inv.number}</bdi></p>
        <div className="head-tools">
          {can("expenses.manage") && inv.kind === "INVOICE" && inv.status === "ISSUED" &&
            <button className="btn btn-danger-quiet" type="button" onClick={() => setVoiding(true)}>إلغاء بإشعار دائن</button>}
          <button className="btn btn-action" type="button" onClick={() => window.print()}>طباعة / حفظ PDF</button>
        </div>
      </div>
      {notice && <p className="notice no-print" role="status">{notice}</p>}
      {inv.status === "VOID" && <p className="hint-box no-print">هذه الفاتورة ملغاة: {inv.void_reason}
        {inv.credit_note_id && <> — <Link href={`/finance/invoice?id=${inv.credit_note_id}`}>الإشعار الدائن <bdi dir="ltr">{inv.credit_note_number}</bdi></Link></>}</p>}

      <article className="invoice" data-void={inv.status === "VOID" || undefined}>
        <header className="inv-head">
          <div>
            <h1>{title}</h1>
            <p className="inv-en" dir="ltr">{inv.kind === "CREDIT_NOTE" ? "Credit Note" : taxInvoice ? "Tax Invoice" : "Invoice"}</p>
          </div>
          {qr && <div className="inv-qr" aria-label="رمز QR للفاتورة الإلكترونية" dangerouslySetInnerHTML={{ __html: qr }} />}
        </header>

        <dl className="inv-meta">
          <div><dt>رقم {inv.kind === "CREDIT_NOTE" ? "الإشعار" : "الفاتورة"}</dt><dd dir="ltr">{inv.number}</dd></div>
          <div><dt>تاريخ الإصدار</dt><dd>{fmt(inv.issued_at)}</dd></div>
          {inv.related_number && <div><dt>عن الفاتورة</dt><dd dir="ltr">{inv.related_number}</dd></div>}
          <div><dt>نوع الإيراد</dt><dd>{INVOICE_SOURCE[inv.source]}</dd></div>
          {inv.payment_reference && <div><dt>مرجع الدفع</dt><dd dir="ltr">{inv.payment_reference}</dd></div>}
        </dl>

        <div className="inv-parties">
          <section>
            <h2>البائع</h2>
            <p><b>{s.legal_name}</b></p>
            {s.vat_number && <p>الرقم الضريبي: <bdi dir="ltr">{s.vat_number}</bdi></p>}
            {s.cr_number && <p>السجل التجاري: <bdi dir="ltr">{s.cr_number}</bdi></p>}
            {s.address && <p>{s.address}</p>}
            {s.email && <p dir="ltr" className="inv-ltr">{s.email}</p>}
          </section>
          <section>
            <h2>المشتري</h2>
            <p><b>{inv.buyer_name}</b></p>
            {inv.buyer_cr && <p>السجل التجاري: <bdi dir="ltr">{inv.buyer_cr}</bdi></p>}
            {inv.buyer_vat && <p>الرقم الضريبي: <bdi dir="ltr">{inv.buyer_vat}</bdi></p>}
          </section>
        </div>

        <table className="table inv-lines">
          <thead><tr><th>البيان</th><th className="num">الكمية</th><th className="num">سعر الوحدة</th><th className="num">المبلغ الخاضع</th>
            <th className="num">الضريبة {Math.round(inv.vat_rate * 100)}%</th><th className="num">الإجمالي</th></tr></thead>
          <tbody>
            {inv.lines.map((l, i) => (
              <tr key={i}><td>{l.description}</td><td className="num">{l.quantity}</td><td className="num">{sar(l.unit_price)}</td>
                <td className="num">{sar(l.net)}</td><td className="num">{sar(l.vat)}</td><td className="num">{sar(l.total)}</td></tr>
            ))}
          </tbody>
        </table>

        <dl className="inv-totals">
          <div><dt>الإجمالي غير شامل الضريبة</dt><dd>{sar(inv.subtotal)}</dd></div>
          <div><dt>ضريبة القيمة المضافة</dt><dd>{sar(inv.vat_amount)}</dd></div>
          <div className="inv-grand"><dt>الإجمالي شامل الضريبة</dt><dd>{sar(inv.total)}</dd></div>
        </dl>

        {inv.note && <p className="inv-note">{inv.note}</p>}
        {s.invoice_note && <p className="inv-note muted">{s.invoice_note}</p>}
        {s.iban && <p className="inv-note">التحويل إلى: <bdi dir="ltr">{s.iban}</bdi></p>}
        {inv.qr && <details className="no-print inv-tlv"><summary>محتوى رمز QR</summary>
          <ol>{parseZatcaTlv(inv.qr).map((v, i) => <li key={i}>{["اسم البائع", "الرقم الضريبي", "وقت الإصدار", "الإجمالي", "الضريبة"][i]}: <bdi dir="ltr">{v}</bdi></li>)}</ol></details>}
      </article>

      <ReasonDialog open={voiding} title={`إلغاء الفاتورة ${inv.number}`} danger confirmLabel="أصدر إشعاراً دائناً"
        description="الفاتورة الصادرة لا تُحذف ولا تُعدَّل نظاماً. سيصدر إشعار دائن بنفس المبالغ يُخصم من الإيراد والضريبة، وتُعلَّم الفاتورة ملغاة."
        onClose={() => setVoiding(false)}
        onConfirm={async (reason) => {
          const r = await api.admin.voidInvoice(inv.id, reason);
          setVoiding(false); setNotice(`صدر الإشعار الدائن ${r.credit_note.number}`); load();
        }} />
    </>
  );
}

export default function InvoicePage() {
  return <Suspense fallback={null}><InvoiceView /></Suspense>;
}
