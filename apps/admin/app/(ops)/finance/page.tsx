"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  EXPENSE_CATEGORY, INVOICE_KIND, INVOICE_SOURCE, INVOICE_STATUS, PLAN_LABEL, periodRange, round2, sar,
  type Expense, type ExpenseInput, type FinanceSummary, type HaseefProfile, type InvoiceRow, type VatReturn,
} from "@haseef/shared";
import { Dialog, ReasonDialog, fmtDateTime, useCan } from "@/components/ui";
import { api } from "@/lib/session";

type Tab = "overview" | "invoices" | "expenses" | "vat" | "profile";
const TABS: [Tab, string, string[]][] = [
  ["overview", "الوضع المالي", ["finance.view"]],
  ["invoices", "الفواتير", ["finance.view", "billing.manage"]],
  ["expenses", "المصروفات", ["finance.view", "expenses.manage"]],
  ["vat", "ضريبة القيمة المضافة", ["finance.view"]],
  ["profile", "بيانات حصيف", ["finance.view", "expenses.manage", "billing.manage"]],
];

const now = new Date(Date.now() + 3 * 3600e3);
const thisMonth = now.toISOString().slice(0, 7);
const thisQuarter = `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
const thisYear = String(now.getUTCFullYear());

/** خيارات الفترة: الأشهر الـ12 الأخيرة، والأرباع الأربعة، والسنتان. */
function periodOptions() {
  const out: [string, string][] = [];
  const y = now.getUTCFullYear();
  out.push([String(y), `سنة ${y}`], [String(y - 1), `سنة ${y - 1}`]);
  for (let q = 4; q >= 1; q--) out.push([`${y}-Q${q}`, `الربع ${q} — ${y}`]);
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(y, now.getUTCMonth() - i, 1));
    const p = d.toISOString().slice(0, 7);
    out.push([p, new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { month: "long", year: "numeric" }).format(d)]);
  }
  return out;
}

function Finance() {
  const can = useCan();
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const tabs = TABS.filter(([, , perms]) => can(...perms));
  const tab = (tabs.find(([t]) => t === sp.get("tab"))?.[0] ?? tabs[0]?.[0]) as Tab | undefined;
  const setTab = (t: Tab) => router.replace(`${path}?tab=${t}`);
  if (!tab) return <p className="hint">لا تملك صلاحية على القسم المالي.</p>;
  return (
    <>
      <h1>المالية</h1>
      <p className="muted">الوضع المالي لحصيف نفسها: الإيرادات من الفواتير الصادرة، والمصروفات، وضريبة القيمة المضافة. الفواتير تصدر تلقائياً عند تسجيل أي دفعة.</p>
      <div className="filters" role="tablist">
        {tabs.map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} aria-pressed={tab === t} onClick={() => setTab(t)}>{label}</button>
        ))}
      </div>
      {tab === "overview" && <Overview />}
      {tab === "invoices" && <Invoices />}
      {tab === "expenses" && <Expenses />}
      {tab === "vat" && <Vat />}
      {tab === "profile" && <Profile />}
    </>
  );
}

export default function FinancePage() {
  return <Suspense fallback={null}><Finance /></Suspense>;
}

function PeriodSelect({ value, onChange, allowAll }: { value: string; onChange: (v: string) => void; allowAll?: boolean }) {
  const opts = useMemo(periodOptions, []);
  return (
    <div className="field inline-select">
      <label htmlFor="fin-period">الفترة</label>
      <select id="fin-period" value={value} onChange={(e) => onChange(e.target.value)}>
        {allowAll && <option value="">كل الفترات</option>}
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------- الوضع المالي
function Overview() {
  const [period, setPeriod] = useState(thisYear);
  const [d, setD] = useState<FinanceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setD(null); api.admin.finSummary(period).then(setD).catch((e: Error) => setError(e.message)); }, [period]);
  if (error) return <p className="error" role="alert">{error}</p>;
  const max = d ? Math.max(1, ...d.monthly.flatMap((m) => [m.revenue, m.expenses])) : 1;
  const monthName = (iso: string) => new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { month: "short", year: "numeric" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
  return (
    <section className="fin-section">
      <div className="head-row"><h2>قائمة الدخل — {periodRange(period).label}</h2><PeriodSelect value={period} onChange={setPeriod} /></div>
      {!d ? <div className="boot" aria-busy="true" /> : (
        <>
          <dl className="kpis">
            <div><dt>الإيرادات (قبل الضريبة)</dt><dd>{sar(d.revenue.total)}</dd></div>
            <div><dt>المصروفات (قبل الضريبة)</dt><dd>{sar(d.expenses.total)}</dd></div>
            <div><dt>{d.net_profit >= 0 ? "صافي الربح" : "صافي الخسارة"}</dt>
              <dd data-tone={d.net_profit >= 0 ? "good" : "bad"}>{sar(Math.abs(d.net_profit))}
                {d.margin !== null && <small>هامش {Math.round(d.margin * 100)}%</small>}</dd></div>
            <div><dt>الإيراد الشهري المتكرر (حالياً)</dt><dd>{sar(round2(d.mrr))}</dd></div>
          </dl>

          <div className="split">
            <section>
              <h3>الإيرادات حسب المصدر</h3>
              <table className="table">
                <thead><tr><th>المصدر</th><th className="num">الصافي</th><th className="num">الضريبة</th><th className="num">فواتير / إشعارات</th></tr></thead>
                <tbody>
                  {d.revenue.by_source.map((r) => (
                    <tr key={r.source}><td>{INVOICE_SOURCE[r.source] ?? r.source}</td><td className="num">{sar(r.net)}</td>
                      <td className="num">{sar(r.vat)}</td><td className="num">{r.invoices} / {r.credit_notes}</td></tr>
                  ))}
                  {d.revenue.by_source.length === 0 && <tr><td colSpan={4} className="muted">لا فواتير في هذه الفترة.</td></tr>}
                </tbody>
              </table>
            </section>
            <section>
              <h3>المصروفات حسب البند</h3>
              <ul className="bars">
                {d.expenses.by_category.map((c) => (
                  <li key={c.category} title={`${EXPENSE_CATEGORY[c.category]}: ${sar(c.net)} (${c.n} قيد)`}>
                    <span>{EXPENSE_CATEGORY[c.category] ?? c.category}</span>
                    <span className="bar"><span style={{ inlineSize: `${(100 * c.net) / (d.expenses.total || 1)}%` }} /></span>
                    <span className="num">{Math.round(c.net).toLocaleString("en")}</span>
                  </li>
                ))}
                {d.expenses.by_category.length === 0 && <li className="muted">لا مصروفات مسجلة في هذه الفترة.</li>}
              </ul>
            </section>
          </div>

          <section>
            <h3>الإيرادات والمصروفات شهرياً</h3>
            <div className="fin-legend" aria-hidden="true"><span data-s="rev">الإيرادات</span><span data-s="exp">المصروفات</span></div>
            <table className="table fin-monthly">
              <thead><tr><th>الشهر</th><th>المقارنة</th><th className="num">الإيرادات</th><th className="num">المصروفات</th><th className="num">الصافي</th></tr></thead>
              <tbody>
                {d.monthly.map((m) => (
                  <tr key={m.month}>
                    <td>{monthName(m.month)}</td>
                    <td className="fin-bars" title={`الإيرادات ${sar(m.revenue)} — المصروفات ${sar(m.expenses)}`}>
                      <span data-s="rev" style={{ inlineSize: `${(100 * Math.max(m.revenue, 0)) / max}%` }} />
                      <span data-s="exp" style={{ inlineSize: `${(100 * m.expenses) / max}%` }} />
                    </td>
                    <td className="num">{sar(m.revenue)}</td><td className="num">{sar(m.expenses)}</td>
                    <td className="num" data-tone={m.revenue - m.expenses >= 0 ? "good" : "bad"}>{sar(round2(m.revenue - m.expenses))}</td>
                  </tr>
                ))}
                {d.monthly.length === 0 && <tr><td colSpan={5} className="muted">لا حركة في هذه الفترة.</td></tr>}
              </tbody>
            </table>
          </section>

          <div className="split">
            <section>
              <h3>ضريبة القيمة المضافة للفترة</h3>
              <dl className="kpis compact">
                <div><dt>ضريبة المخرجات</dt><dd>{sar(d.vat.output)}</dd></div>
                <div><dt>ضريبة المدخلات</dt><dd>{sar(d.vat.input)}</dd></div>
                <div><dt>{d.vat.payable >= 0 ? "المستحق للهيئة" : "رصيد مسترد"}</dt><dd>{sar(Math.abs(d.vat.payable))}</dd></div>
              </dl>
            </section>
            <section>
              <h3>تجديدات مستحقة خلال 30 يوماً</h3>
              {d.renewals_due.length === 0 ? <p className="muted">لا تجديدات قريبة.</p> : (
                <>
                  <p className="hint">المتوقع تحصيله: <b>{sar(d.renewals_expected)}</b> قبل الضريبة.</p>
                  <ul className="fin-due">
                    {d.renewals_due.map((r) => (
                      <li key={r.org_id}><Link href={`/organizations/${r.org_id}`}>{r.name}</Link>
                        <span className="muted small">{PLAN_LABEL[r.plan_tier] ?? r.plan_tier} · {r.billing_cycle === "YEARLY" ? "سنوي" : "شهري"} · ينتهي {fmtDateTime(r.ends_at).split("،")[0]}</span>
                        <span className="num">{sar(r.expected)}</span></li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>
          <p className="hint">الإيراد هنا على أساس الفواتير الصادرة في الفترة (الاشتراك السنوي يُحتسب كاملاً في شهر دفعه)، والإشعارات الدائنة تُخصم منه.</p>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- الفواتير
function Invoices() {
  const [period, setPeriod] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { api.admin.invoices(period || undefined, q.trim() || undefined).then(setRows).catch((e: Error) => setError(e.message)); }, [period, q]);
  useEffect(load, [load]);
  if (error) return <p className="error" role="alert">{error}</p>;
  const issued = rows?.filter((r) => r.kind === "INVOICE") ?? [];
  const totals = rows ? round2(rows.reduce((a, r) => a + (r.kind === "INVOICE" ? r.total : -r.total), 0)) : 0;
  return (
    <section className="fin-section">
      <div className="head-row">
        <h2>الفواتير والإشعارات الدائنة {rows && <span className="muted">({rows.length})</span>}</h2>
        <div className="head-tools">
          <div className="field inline"><label htmlFor="inv-q" className="sr-only">بحث</label>
            <input id="inv-q" type="search" placeholder="رقم الفاتورة أو اسم المنشأة" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <PeriodSelect value={period} onChange={setPeriod} allowAll />
        </div>
      </div>
      {rows && <p className="hint">{issued.length} فاتورة، والصافي شامل الضريبة بعد الإشعارات الدائنة: <b>{sar(totals)}</b></p>}
      <table className="table table-click">
        <thead><tr><th>الرقم</th><th>النوع</th><th>المشتري</th><th>المصدر</th><th>التاريخ</th><th className="num">قبل الضريبة</th><th className="num">الضريبة</th><th className="num">الإجمالي</th><th>الحالة</th></tr></thead>
        <tbody>
          {rows?.map((r) => (
            <tr key={r.id}>
              <td><Link className="row-link" href={`/finance/invoice?id=${r.id}`}><bdi dir="ltr">{r.number}</bdi></Link>
                {r.related_number && <div className="muted small">عن <bdi dir="ltr">{r.related_number}</bdi></div>}</td>
              <td>{INVOICE_KIND[r.kind]}</td>
              <td>{r.buyer_name}</td>
              <td>{INVOICE_SOURCE[r.source]}</td>
              <td>{fmtDateTime(r.issued_at)}</td>
              <td className="num">{r.kind === "CREDIT_NOTE" ? "−" : ""}{sar(r.subtotal)}</td>
              <td className="num">{r.kind === "CREDIT_NOTE" ? "−" : ""}{sar(r.vat_amount)}</td>
              <td className="num"><b>{r.kind === "CREDIT_NOTE" ? "−" : ""}{sar(r.total)}</b></td>
              <td>{r.kind === "INVOICE" && <span className="pill" data-tone={r.status === "ISSUED" ? "good" : "bad"}>{INVOICE_STATUS[r.status]}</span>}</td>
            </tr>
          ))}
          {rows?.length === 0 && <tr><td colSpan={9} className="muted">لا فواتير. تصدر تلقائياً عند تسجيل دفعة اشتراك أو دفع استشارة.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

// ---------------------------------------------------------------- المصروفات
const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const EMPTY: ExpenseInput = { spent_on: today(), category: "HOSTING", vendor: "", description: null, net_amount: 0, vat_amount: 0, reference: null, recurring: false };

function Expenses() {
  const can = useCan();
  const editor = can("expenses.manage");
  const [period, setPeriod] = useState(thisMonth);
  const [rows, setRows] = useState<Expense[] | null>(null);
  const [edit, setEdit] = useState<{ id: string | null; v: ExpenseInput } | null>(null);
  const [del, setDel] = useState<Expense | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api.admin.expenses(period || undefined).then(setRows).catch((e: Error) => setNotice(e.message)); }, [period]);
  useEffect(load, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy(true); setFormError(null);
    try {
      if (edit.id) await api.admin.updateExpense(edit.id, edit.v); else await api.admin.addExpense(edit.v);
      setNotice(edit.id ? "عُدّل المصروف" : "سُجّل المصروف"); setEdit(null); load();
    } catch (err) { setFormError(err instanceof Error ? err.message : "تعذّر الحفظ"); } finally { setBusy(false); }
  }
  const v = edit?.v;
  const set = (patch: Partial<ExpenseInput>) => edit && setEdit({ ...edit, v: { ...edit.v, ...patch } });
  const total = rows ? round2(rows.reduce((a, r) => a + r.net_amount, 0)) : 0;

  return (
    <section className="fin-section">
      <div className="head-row">
        <h2>المصروفات {rows && <span className="muted">({rows.length})</span>}</h2>
        <div className="head-tools">
          <PeriodSelect value={period} onChange={setPeriod} allowAll />
          {editor && <button className="btn btn-action" type="button" onClick={() => { setFormError(null); setEdit({ id: null, v: { ...EMPTY, spent_on: today() } }); }}>مصروف جديد</button>}
        </div>
      </div>
      {!editor && <p className="hint">العرض فقط. تسجيل المصروفات يتطلب صلاحية «المصروفات وبيانات الفوترة».</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {rows && <p className="hint">المجموع قبل الضريبة: <b>{sar(total)}</b> — ضريبة المدخلات القابلة للخصم: <b>{sar(round2(rows.reduce((a, r) => a + r.vat_amount, 0)))}</b></p>}
      <table className="table">
        <thead><tr><th>التاريخ</th><th>البند</th><th>المورّد</th><th className="num">قبل الضريبة</th><th className="num">الضريبة</th><th className="num">الإجمالي</th><th><span className="sr-only">إجراءات</span></th></tr></thead>
        <tbody>
          {rows?.map((r) => (
            <tr key={r.id}>
              <td>{r.spent_on}</td>
              <td>{EXPENSE_CATEGORY[r.category] ?? r.category}{r.recurring && <span className="pill">شهري</span>}</td>
              <td>{r.vendor}{r.description && <div className="muted small">{r.description}</div>}{r.reference && <div className="muted small">مرجع: <bdi dir="ltr">{r.reference}</bdi></div>}</td>
              <td className="num">{sar(r.net_amount)}</td><td className="num">{sar(r.vat_amount)}</td><td className="num"><b>{sar(r.total)}</b></td>
              <td className="row-actions-cell">{editor && <>
                <button className="link-btn" type="button" onClick={() => { setFormError(null); setEdit({ id: r.id, v: { spent_on: r.spent_on, category: r.category, vendor: r.vendor, description: r.description,
                  net_amount: r.net_amount, vat_amount: r.vat_amount, reference: r.reference, recurring: r.recurring } }); }}>تعديل</button>
                <button className="link-btn danger" type="button" onClick={() => setDel(r)}>حذف</button></>}</td>
            </tr>
          ))}
          {rows?.length === 0 && <tr><td colSpan={7} className="muted">لا مصروفات في هذه الفترة.</td></tr>}
        </tbody>
      </table>

      <Dialog open={!!edit} title={edit?.id ? "تعديل مصروف" : "مصروف جديد"} onClose={() => setEdit(null)}>
        {v && (
          <form className="dialog-body" onSubmit={save}>
            <div className="grid">
              <div className="field"><label htmlFor="x-date">التاريخ</label><input id="x-date" type="date" required value={v.spent_on} onChange={(e) => set({ spent_on: e.target.value })} /></div>
              <div className="field"><label htmlFor="x-cat">البند</label>
                <select id="x-cat" value={v.category} onChange={(e) => set({ category: e.target.value })}>
                  {Object.entries(EXPENSE_CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select></div>
            </div>
            <div className="field"><label htmlFor="x-vendor">المورّد</label><input id="x-vendor" required minLength={2} value={v.vendor} onChange={(e) => set({ vendor: e.target.value })} /></div>
            <div className="grid">
              <div className="field"><label htmlFor="x-net">المبلغ قبل الضريبة (ريال)</label>
                <input id="x-net" type="number" min="0.01" step="0.01" required dir="ltr" value={v.net_amount || ""} onChange={(e) => set({ net_amount: Number(e.target.value) })} /></div>
              <div className="field"><label htmlFor="x-vat">ضريبة المدخلات (ريال)</label>
                <input id="x-vat" type="number" min="0" step="0.01" dir="ltr" value={v.vat_amount || ""} onChange={(e) => set({ vat_amount: Number(e.target.value) })} />
                <button className="link-btn" type="button" onClick={() => set({ vat_amount: round2(v.net_amount * 0.15) })}>احسب 15%</button></div>
            </div>
            <p className="hint">ضريبة المدخلات تُخصم في الإقرار فقط إذا كان لديك فاتورة ضريبية من مورّد مسجّل. اتركها صفراً للرسوم الحكومية والرواتب.</p>
            <div className="field"><label htmlFor="x-desc">الوصف (اختياري)</label><input id="x-desc" value={v.description ?? ""} onChange={(e) => set({ description: e.target.value || null })} /></div>
            <div className="grid">
              <div className="field"><label htmlFor="x-ref">رقم فاتورة المورّد (اختياري)</label><input id="x-ref" dir="ltr" value={v.reference ?? ""} onChange={(e) => set({ reference: e.target.value || null })} /></div>
              <label className="check-row"><input type="checkbox" checked={v.recurring} onChange={(e) => set({ recurring: e.target.checked })} /> مصروف شهري متكرر</label>
            </div>
            {formError && <p className="error" role="alert">{formError}</p>}
            <div className="dialog-actions">
              <button className="btn btn-action" type="submit" disabled={busy}>{edit?.id ? "حفظ" : "سجّل المصروف"}</button>
              <button className="btn btn-quiet" type="button" onClick={() => setEdit(null)}>إلغاء</button>
            </div>
          </form>
        )}
      </Dialog>
      <ReasonDialog open={!!del} title="حذف مصروف" danger confirmLabel="احذف"
        description={del ? `سيُحذف مصروف ${del.vendor} بمبلغ ${sar(del.total)} ويُسجَّل الحذف في سجل التدقيق.` : ""}
        onClose={() => setDel(null)}
        onConfirm={async () => { if (del) { await api.admin.deleteExpense(del.id); setDel(null); setNotice("حُذف المصروف"); load(); } }} />
    </section>
  );
}

// ---------------------------------------------------------------- الضريبة
function Vat() {
  const [period, setPeriod] = useState(thisQuarter);
  const [d, setD] = useState<VatReturn | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setD(null); api.admin.vatReturn(period).then(setD).catch((e: Error) => setError(e.message)); }, [period]);
  const quarters = useMemo(() => {
    const y = now.getUTCFullYear();
    return [y, y - 1].flatMap((yy) => [4, 3, 2, 1].map((q) => `${yy}-Q${q}`));
  }, []);
  if (error) return <p className="error" role="alert">{error}</p>;
  return (
    <section className="fin-section">
      <div className="head-row">
        <h2>ملخص إقرار ضريبة القيمة المضافة</h2>
        <div className="field inline-select"><label htmlFor="vat-q">الربع</label>
          <select id="vat-q" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {quarters.map((q) => <option key={q} value={q}>{periodRange(q).label}</option>)}
          </select></div>
      </div>
      {!d ? <div className="boot" aria-busy="true" /> : (
        <>
          <table className="table vat-table">
            <tbody>
              <tr><th colSpan={2}>المبيعات</th></tr>
              <tr><td>المبيعات الخاضعة للنسبة الأساسية (15%)</td><td className="num">{sar(d.sales.sales)}</td></tr>
              <tr><td>التعديلات (إشعارات دائنة)</td><td className="num">−{sar(d.sales.adjustments)}</td></tr>
              <tr><td><b>ضريبة المخرجات</b></td><td className="num"><b>{sar(d.sales.vat)}</b></td></tr>
              <tr><th colSpan={2}>المشتريات</th></tr>
              <tr><td>المشتريات الخاضعة بفواتير ضريبية</td><td className="num">{sar(d.purchases.purchases)}</td></tr>
              <tr><td><b>ضريبة المدخلات القابلة للخصم</b></td><td className="num"><b>{sar(d.purchases.vat)}</b></td></tr>
              <tr className="vat-total"><td><b>{d.payable >= 0 ? "صافي الضريبة المستحقة للهيئة" : "رصيد دائن قابل للاسترداد أو الترحيل"}</b></td>
                <td className="num"><b>{sar(Math.abs(d.payable))}</b></td></tr>
            </tbody>
          </table>
          <p className="hint">يُقدَّم الإقرار ويُسدَّد عبر بوابة هيئة الزكاة والضريبة والجمارك قبل <b>{d.file_by}</b>. هذا ملخص للمساعدة في التعبئة؛ يراجعه المحاسب قبل التقديم.</p>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- بيانات حصيف
function Profile() {
  const can = useCan();
  const editor = can("expenses.manage");
  const [p, setP] = useState<HaseefProfile | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.admin.finProfile().then(setP).catch((e: Error) => setError(e.message)); }, []);
  if (!p) return error ? <p className="error" role="alert">{error}</p> : null;
  const set = (patch: Partial<HaseefProfile>) => setP({ ...p, ...patch });
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!p) return;
    setBusy(true); setError(null); setNotice(null);
    try { await api.admin.saveFinProfile(p); setNotice("حُفظت البيانات. تظهر في الفواتير الجديدة فقط؛ الصادرة لا تتغير."); }
    catch (err) { setError(err instanceof Error ? err.message : "تعذّر الحفظ"); } finally { setBusy(false); }
  }
  const txt = (k: keyof HaseefProfile, label: string, o: { dir?: "ltr"; ph?: string; req?: boolean } = {}) => (
    <div className="field"><label htmlFor={`pf-${k}`}>{label}</label>
      <input id={`pf-${k}`} dir={o.dir} placeholder={o.ph} required={o.req} disabled={!editor} value={(p[k] as string | null) ?? ""}
             onChange={(e) => set({ [k]: e.target.value || null } as Partial<HaseefProfile>)} /></div>
  );
  return (
    <form className="fin-section" onSubmit={save}>
      <h2>بيانات حصيف في الفواتير</h2>
      <p className="hint">تظهر هذه البيانات كبائع في كل فاتورة تصدر. التسجيل في ضريبة القيمة المضافة إلزامي عند تجاوز الإيرادات السنوية 375 ألف ريال.</p>
      {notice && <p className="notice" role="status">{notice}</p>}
      <div className="grid">
        {txt("legal_name", "الاسم النظامي", { req: true })}
        {txt("trade_name", "الاسم التجاري", { req: true })}
        {txt("cr_number", "السجل التجاري", { dir: "ltr", ph: "10 أرقام" })}
      </div>
      <label className="check-row"><input type="checkbox" disabled={!editor} checked={p.vat_registered} onChange={(e) => set({ vat_registered: e.target.checked })} />
        مسجّلة في ضريبة القيمة المضافة (تصدر فواتير ضريبية برمز QR وتُضاف 15%)</label>
      <div className="grid">
        {txt("vat_number", "الرقم الضريبي", { dir: "ltr", ph: "3xxxxxxxxxxxxx3" })}
        {txt("email", "بريد الفوترة", { dir: "ltr" })}
        {txt("phone", "هاتف", { dir: "ltr" })}
        {txt("iban", "الآيبان للتحويل", { dir: "ltr", ph: "SA..." })}
      </div>
      {txt("address", "العنوان")}
      {txt("invoice_note", "ملاحظة أسفل الفاتورة")}
      {error && <p className="error" role="alert">{error}</p>}
      {editor && <div className="dialog-actions"><button className="btn btn-action" type="submit" disabled={busy}>حفظ البيانات</button></div>}
    </form>
  );
}
