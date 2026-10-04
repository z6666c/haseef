"use client";

import { useEffect, useState } from "react";
import { INVOICE_KIND, PLAN_LABEL, formatDate, round2, sar, type BillingOverview } from "@haseef/shared";
import { api } from "@/lib/session";

const STATUS: Record<string, string> = { ACTIVE: "فعّال", TRIAL: "تجربة مجانية", PAST_DUE: "متأخر السداد", CANCELED: "ملغى", EXPIRED: "منتهٍ" };

export default function BillingPage() {
  const [d, setD] = useState<BillingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.billingOverview().then(setD).catch((e: Error) => setError(e.message)); }, []);
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!d) return <div className="boot" aria-busy="true" />;

  const s = d.subscription, p = d.plan;
  const vat = 1 + d.vat_rate;
  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const next = p?.items.find((i) => !i.paid_at);

  return (
    <>
      <header className="page-head">
        <h1>الاشتراك والدفعات</h1>
        <p className="muted">باقتك ومدة اشتراكك، وجدول الأقساط بالمدفوع والمتبقي، وفواتيرك الضريبية.</p>
      </header>

      {s ? (
        <section className="panel bill-sub">
          <div><span className="muted small">الباقة</span><b>{PLAN_LABEL[s.plan_tier] ?? s.plan_tier}</b></div>
          <div><span className="muted small">الاشتراك</span><b>{s.billing_cycle === "YEARLY" ? "سنوي" : "شهري"} · {STATUS[s.billing_status] ?? s.billing_status}</b></div>
          <div><span className="muted small">المدة</span><b>{formatDate(s.starts_at.slice(0, 10))} — {formatDate(s.ends_at.slice(0, 10))}</b></div>
        </section>
      ) : <p className="empty">لا يوجد اشتراك قائم. تواصل مع فريق حصيف للاشتراك.</p>}

      {p && (
        <section className="bill-plan">
          <h2>السداد بالأقساط</h2>
          <div className="bill-kpis">
            <div><span>قيمة العقد</span><b>{sar(round2(p.total_net * vat))}</b><small>{sar(p.total_net)} قبل الضريبة</small></div>
            <div data-tone="good"><span>المدفوع</span><b>{sar(round2(p.paid_net * vat))}</b><small>{p.paid_count} من {p.installments} أقساط</small></div>
            <div><span>المتبقي</span><b>{sar(round2(p.remaining_net * vat))}</b><small>{p.installments - p.paid_count} أقساط</small></div>
            {next && <div data-tone={next.due_date < today ? "bad" : "warn"}><span>{next.due_date < today ? "قسط متأخر" : "القسط القادم"}</span>
              <b>{sar(round2(next.amount_net * vat))}</b><small>{next.due_date < today ? "كان مستحقاً" : "يستحق"} {formatDate(next.due_date)}</small></div>}
          </div>
          <div className="bill-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((100 * p.paid_net) / p.total_net)}
               aria-label="نسبة السداد"><span style={{ inlineSize: `${(100 * p.paid_net) / p.total_net}%` }} /></div>

          <table className="report-table">
            <thead><tr><th>القسط</th><th>تاريخ الاستحقاق</th><th>المبلغ شامل الضريبة</th><th>الحالة</th><th>الفاتورة</th></tr></thead>
            <tbody>
              {p.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.seq} من {p.installments}</td>
                  <td>{formatDate(i.due_date)}</td>
                  <td>{sar(round2(i.amount_net * vat))}</td>
                  <td><span className="status" data-s={i.paid_at ? "ACTIVE" : i.due_date < today ? "EXPIRED" : "EXPIRING_SOON"}>
                    {i.paid_at ? `مدفوع ${formatDate(i.paid_at.slice(0, 10))}` : i.due_date < today ? "متأخر" : "قادم"}</span></td>
                  <td dir="ltr">{i.invoice_number ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint-box">يصلك تذكير بالبريد والواتساب قبل موعد كل قسط بـ7 أيام، ويوم الاستحقاق، وبعد 3 أيام إن لم يُسجَّل الدفع.
            للسداد أو تعديل الخطة تواصل مع فريق حصيف.</p>
        </section>
      )}

      <section>
        <h2>الفواتير</h2>
        {d.invoices.length === 0 ? <p className="empty">لا فواتير بعد.</p> : (
          <table className="report-table">
            <thead><tr><th>الرقم</th><th>النوع</th><th>التاريخ</th><th>قبل الضريبة</th><th>الضريبة</th><th>الإجمالي</th></tr></thead>
            <tbody>
              {d.invoices.map((v) => (
                <tr key={v.id}>
                  <td dir="ltr">{v.number}</td>
                  <td>{INVOICE_KIND[v.kind] ?? v.kind}{v.status === "VOID" && <span className="tag tag-quiet">ملغاة</span>}</td>
                  <td>{formatDate(v.issued_at.slice(0, 10))}</td>
                  <td>{v.kind === "CREDIT_NOTE" ? "−" : ""}{sar(v.subtotal)}</td>
                  <td>{v.kind === "CREDIT_NOTE" ? "−" : ""}{sar(v.vat_amount)}</td>
                  <td><b>{v.kind === "CREDIT_NOTE" ? "−" : ""}{sar(v.total)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
