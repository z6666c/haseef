"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { TAX_HINT, countDays, formatDate, sar, type TaxOverview, type TaxProfile, type TaxTask } from "@haseef/shared";
import { api } from "@/lib/session";

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const DEFAULT: TaxProfile = { vat_registered: false, vat_frequency: "QUARTERLY", withholding_applies: false, zakat_applies: true, fiscal_year_end_month: 12 };

function state(t: TaxTask): { s?: string; label: string } {
  if (t.done_at) return { s: "IN_PLACE", label: "قُدّم" };
  if (t.overdue) return { s: "FAIL", label: `متأخر ${countDays(-t.days_left)}` };
  if (t.days_left === 0) return { s: "PENDING", label: "اليوم" };
  return { s: t.days_left <= 10 ? "PENDING" : undefined, label: `بعد ${countDays(t.days_left)}` };
}

export default function TaxPage() {
  const [ov, setOv] = useState<TaxOverview | null>(null);
  const [p, setP] = useState<TaxProfile>(DEFAULT);
  const [editing, setEditing] = useState(false);
  const [doing, setDoing] = useState<TaxTask | null>(null);
  const [ref, setRef] = useState("");
  const [amount, setAmount] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.taxOverview().then((o) => { setOv(o); if (o.profile) setP(o.profile); }).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  async function act(fn: () => Promise<unknown>, ok: string) {
    setError(null); setNotice(null);
    try { await fn(); setNotice(ok); load(); return true; } catch (e) { setError(e instanceof Error ? e.message : "تعذّر"); return false; }
  }
  if (!ov) return error ? <p className="error">{error}</p> : <div className="boot" aria-busy="true" />;
  const open = ov.tasks.filter((t) => !t.done_at);

  const form = (
    <form className="panel inline-form" onSubmit={async (e) => { e.preventDefault(); if (await act(() => api.setTaxProfile(p), "حُفظ الملف الضريبي")) setEditing(false); }}>
      <h2>الملف الضريبي</h2>
      <div className="grid">
        <label className="checks-inline field-wide"><input type="checkbox" checked={p.vat_registered} onChange={(e) => setP({ ...p, vat_registered: e.target.checked })} /> مسجلة في ضريبة القيمة المضافة</label>
        {p.vat_registered && <div className="field"><label>دورية الإقرار</label>
          <select value={p.vat_frequency} onChange={(e) => setP({ ...p, vat_frequency: e.target.value as TaxProfile["vat_frequency"] })}>
            <option value="QUARTERLY">ربع سنوية (التوريدات حتى 40 مليون ريال)</option><option value="MONTHLY">شهرية (أكثر من 40 مليون ريال)</option></select></div>}
        <div className="field"><label>نهاية السنة المالية</label>
          <select value={p.fiscal_year_end_month} onChange={(e) => setP({ ...p, fiscal_year_end_month: Number(e.target.value) })}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></div>
        <label className="checks-inline field-wide"><input type="checkbox" checked={p.zakat_applies} onChange={(e) => setP({ ...p, zakat_applies: e.target.checked })} /> تقدّم المنشأة إقراراً زكوياً</label>
        <label className="checks-inline field-wide"><input type="checkbox" checked={p.withholding_applies} onChange={(e) => setP({ ...p, withholding_applies: e.target.checked })} /> تدفع لجهات غير مقيمة (ضريبة الاستقطاع)</label>
      </div>
      {ov.can_manage && <div style={{ display: "flex", gap: 8 }}><button className="btn btn-action" type="submit">حفظ</button>
        {ov.enabled && <button className="btn btn-quiet" type="button" onClick={() => setEditing(false)}>إلغاء</button>}</div>}
    </form>
  );

  return (
    <>
      <header className="page-head">
        <h1>الزكاة والضريبة</h1>
        <p className="muted">مواعيد إقرارات ضريبة القيمة المضافة وضريبة الاستقطاع والزكاة، مع تنبيه قبل 10 أيام و3 أيام ويوم ويوم الاستحقاق.
          حصيف لا يقدّم الإقرارات نيابة عنك: قدّمها في <a href="https://zatca.gov.sa" target="_blank" rel="noreferrer">بوابة الهيئة</a> ثم أكّد هنا.</p>
      </header>
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {!ov.enabled || editing ? form : (
        <>
          <dl className="obl-stats">
            <div><dt>إقرارات مفتوحة</dt><dd data-s={open.some((t) => t.overdue) ? "LATE" : "PENDING"}>{open.length}</dd></div>
            <div><dt>الأقرب</dt><dd className="num-dd">{open.length ? formatDate([...open].sort((a, b) => a.due_date.localeCompare(b.due_date))[0].due_date) : "—"}</dd></div>
            <div><dt>القيمة المضافة</dt><dd className="num-dd">{ov.profile?.vat_registered ? (ov.profile.vat_frequency === "MONTHLY" ? "شهرية" : "ربع سنوية") : "غير مسجلة"}</dd></div>
          </dl>
          <div className="tabs-row">
            <span />
            <div style={{ display: "flex", gap: 8 }}>
              {ov.can_manage && <button className="btn btn-quiet" type="button" onClick={() => setEditing(true)}>تعديل الملف الضريبي</button>}
              <Link className="btn btn-quiet" href="/alerts">ضبط التنبيهات ←</Link>
            </div>
          </div>
          <table className="deadlines labor-table">
            <thead><tr><th>الإقرار</th><th>الموعد</th><th>الحالة</th><th>المبلغ</th><th /></tr></thead>
            <tbody>
              {ov.tasks.map((t) => {
                const s = state(t);
                return (
                  <tr key={t.id}>
                    <td><b>{t.label}</b><div className="small muted">{t.period_label} · {TAX_HINT[t.kind]}</div>
                      {t.done_at && <div className="small muted">أكّده {t.done_by_name ?? "—"}{t.reference && <> · مرجع <bdi dir="ltr">{t.reference}</bdi></>}</div>}</td>
                    <td>{formatDate(t.due_date)}</td>
                    <td><span className="status-chip" data-s={s.s}>{s.label}</span></td>
                    <td className="num">{t.amount ? sar(t.amount) : "—"}</td>
                    <td>{ov.can_manage && (t.done_at
                      ? <button className="btn btn-quiet btn-xs" type="button" onClick={() => act(() => api.taxReopen(t.id), "أُعيد فتح الإقرار")}>تراجع</button>
                      : <button className="btn btn-action btn-xs" type="button" onClick={() => { setDoing(t); setRef(""); setAmount(""); }}>قُدّم</button>)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="small muted">التأخير في الإقرار أو السداد يعرّض المنشأة لغرامات. المواعيد إرشادية؛ والمرجع النهائي ما يظهر في حسابك لدى الهيئة.</p>
        </>
      )}
      {doing && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={doing.label} onClick={(e) => { if (e.target === e.currentTarget) setDoing(null); }}>
          <form className="modal" onSubmit={async (e) => { e.preventDefault(); if (await act(() => api.taxDone(doing.id, { reference: ref.trim() || null, amount: amount ? Number(amount) : null }), `سُجّل: ${doing.label}`)) setDoing(null); }}>
            <h2>{doing.label} — {doing.period_label}</h2>
            <div className="field"><label htmlFor="tr">رقم الإقرار أو فاتورة سداد</label><input id="tr" dir="ltr" maxLength={100} value={ref} onChange={(e) => setRef(e.target.value)} /></div>
            <div className="field"><label htmlFor="ta">المبلغ المسدد (اختياري)</label><input id="ta" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="modal-actions"><button className="btn btn-action" type="submit">تأكيد</button><button className="btn btn-quiet" type="button" onClick={() => setDoing(null)}>إلغاء</button></div>
          </form>
        </div>
      )}
    </>
  );
}
