"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CONSULT_MODE_LABEL, CONSULT_STATUS_LABEL, PAYMENT_STATUS_LABEL, PLAN_LABEL, minutesLabel, sarFmt,
  type Consultation, type LegalBookInput, type LegalQuote, type LegalRatesInfo,
} from "@haseef/shared";
import { api } from "@/lib/session";

const fmt = (d: string | null) => d
  ? new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { dateStyle: "full", timeStyle: "short", timeZone: "Asia/Riyadh" }).format(new Date(d))
  : "—";
const localInput = (h: number) => new Date(Date.now() + h * 3600e3 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export default function LegalPage() {
  const [info, setInfo] = useState<LegalRatesInfo | null>(null);
  const [mine, setMine] = useState<Consultation[]>([]);
  const [f, setF] = useState<LegalBookInput>({ topic: "", duration_minutes: 60, urgent: false, subject: "", details: null, mode: "VIDEO", preferred_at: localInput(26) });
  const [q, setQ] = useState<LegalQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => { api.legalMine().then(setMine).catch(() => {}); }, []);
  useEffect(() => {
    api.legalRates().then((r) => { setInfo(r); setF((x) => ({ ...x, topic: r.rates[0]?.topic ?? "" })); }).catch((e: Error) => setError(e.message));
    load();
  }, [load]);
  useEffect(() => {
    if (!f.topic) return;
    api.legalQuote({ topic: f.topic, duration_minutes: f.duration_minutes, urgent: f.urgent }).then(setQ).catch(() => setQ(null));
  }, [f.topic, f.duration_minutes, f.urgent]);

  async function book(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await api.legalBook({ ...f, preferred_at: new Date(f.preferred_at).toISOString(), details: f.details || null });
      setNotice(`أُرسل طلبك بإجمالي ${sarFmt(r.total_sar)}. يؤكد فريق حصيف الموعد والمحامي خلال يوم عمل، ثم تصلك تفاصيل الدفع والاجتماع.`);
      setF({ ...f, subject: "", details: null });
      load();
    } catch (err) { setError(err instanceof Error ? err.message : "تعذّر إرسال الطلب"); }
    finally { setBusy(false); }
  }

  async function cancel(c: Consultation) {
    const reason = window.prompt("سبب الإلغاء:");
    if (!reason || reason.trim().length < 3) return;
    setError(null);
    try { await api.legalCancel(c.id, reason.trim()); setNotice("أُلغي الطلب"); load(); }
    catch (err) { setError(err instanceof Error ? err.message : "تعذّر الإلغاء"); }
  }

  if (!info) return error ? <p className="error" role="alert">{error}</p> : <div className="boot" aria-busy="true" />;
  const rate = info.rates.find((r) => r.topic === f.topic);

  return (
    <>
      <header className="page-head">
        <h1>استشارة محامٍ مرخّص</h1>
        <p className="muted">استشارة قانونية بالساعة مع محامين مرخّصين متخصصين في الشركات والعقود والعمل وحماية البيانات. السعر واضح قبل الطلب، ولا تدفع إلا بعد تأكيد الموعد.</p>
      </header>

      <section className="rate-cards" aria-label="الأسعار">
        {info.rates.map((r) => (
          <button key={r.topic} type="button" className="rate-card" aria-pressed={f.topic === r.topic} onClick={() => setF({ ...f, topic: r.topic })}>
            <span className="tag">{r.tier === "SPECIALIZED" ? "متخصصة" : "عامة"}</span>
            <strong>{r.title}</strong>
            <span className="rate-price"><b>{Number(r.hourly_rate_sar).toLocaleString("en-US")}</b> ريال / ساعة</span>
            {r.description && <small className="muted">{r.description}</small>}
          </button>
        ))}
      </section>
      <p className="small muted">
        الأسعار قبل ضريبة القيمة المضافة ({info.vat_pct}%). الاستشارة العاجلة (خلال 48 ساعة) +{info.urgent_pct}%.
        {info.plan_discount_pct > 0 && <> خصم باقتك ({PLAN_LABEL[info.plan_tier ?? ""] ?? info.plan_tier}): <strong>{info.plan_discount_pct}%</strong>.</>}
      </p>

      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      <form className="panel legal-form" onSubmit={book}>
        <div className="legal-grid">
          <div className="inline-form">
            <h2>اطلب استشارة: {rate?.title}</h2>
            <div className="field"><label htmlFor="subj">موضوع الاستشارة</label>
              <input id="subj" required minLength={3} placeholder="مثال: مراجعة عقد توريد قبل التوقيع" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></div>
            <div className="field"><label htmlFor="det">التفاصيل (تبقى سرية بينك وبين المحامي)</label>
              <textarea id="det" rows={4} value={f.details ?? ""} onChange={(e) => setF({ ...f, details: e.target.value })} /></div>
            <div className="grid">
              <div className="field"><label>المدة</label>
                <select value={f.duration_minutes} onChange={(e) => setF({ ...f, duration_minutes: Number(e.target.value) })}>
                  {info.durations.map((m) => <option key={m} value={m}>{minutesLabel(m)}</option>)}</select></div>
              <div className="field"><label>طريقة الاستشارة</label>
                <select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as LegalBookInput["mode"] })}>
                  {Object.entries(CONSULT_MODE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              <div className="field"><label>الموعد المفضل</label>
                <input type="datetime-local" required value={f.preferred_at} onChange={(e) => setF({ ...f, preferred_at: e.target.value })} /></div>
            </div>
            <label className="small"><input type="checkbox" checked={f.urgent} onChange={(e) => setF({ ...f, urgent: e.target.checked, preferred_at: e.target.checked ? localInput(4) : f.preferred_at })} /> عاجلة: خلال 48 ساعة (+{info.urgent_pct}%)</label>
          </div>

          <aside className="quote" aria-live="polite">
            <h3>تفصيل السعر</h3>
            {q ? (
              <dl>
                <div><dt>{Number(q.hourly_rate).toLocaleString("en-US")} ريال × {minutesLabel(q.minutes)}</dt><dd>{sarFmt(q.base)}</dd></div>
                {q.urgent_fee > 0 && <div><dt>رسم الاستعجال ({q.urgent_pct}%)</dt><dd>+ {sarFmt(q.urgent_fee)}</dd></div>}
                {q.discount > 0 && <div className="disc"><dt>خصم الباقة ({q.discount_pct}%)</dt><dd>− {sarFmt(q.discount)}</dd></div>}
                <div><dt>ضريبة القيمة المضافة ({q.vat_pct}%)</dt><dd>{sarFmt(q.vat)}</dd></div>
                <div className="total"><dt>الإجمالي</dt><dd>{sarFmt(q.total)}</dd></div>
              </dl>
            ) : <p className="muted">—</p>}
            <button className="btn btn-action" type="submit" disabled={busy || !q}>{busy ? "جارٍ الإرسال…" : "اطلب الاستشارة"}</button>
            <p className="small muted">لا يُخصم أي مبلغ الآن. الإلغاء مجاني قبل التأكيد، وقبل الموعد المؤكد بـ 24 ساعة.</p>
          </aside>
        </div>
      </form>

      <section className="gov-section">
        <h2>طلباتي ({mine.length})</h2>
        {mine.length === 0 ? <p className="empty">لا طلبات بعد.</p> : (
          <ul className="ropa-list">
            {mine.map((c) => (
              <li key={c.id}>
                <div className="res-head">
                  <strong>{c.subject}</strong>
                  <span className="tag">{c.topic_title}</span>
                  <span className="status-chip" data-s={c.status === "CONFIRMED" || c.status === "COMPLETED" ? "IN_PLACE" : c.status === "CANCELED" ? "OBSOLETE" : "PENDING"}>{CONSULT_STATUS_LABEL[c.status]}</span>
                  {c.status !== "CANCELED" && <span className="status-chip" data-s={c.payment_status === "PAID" ? "IN_PLACE" : "PENDING"}>{PAYMENT_STATUS_LABEL[c.payment_status]}</span>}
                  {c.urgent && <span className="risk" data-r="HIGH">عاجلة</span>}
                </div>
                <p className="small muted">{minutesLabel(c.duration_minutes)} · {CONSULT_MODE_LABEL[c.mode]} · {sarFmt(c.total_sar)}</p>
                {c.status === "CONFIRMED" ? (
                  <p className="small tracked">الموعد: {fmt(c.scheduled_at)} — مع {c.lawyer_name} (ترخيص {c.lawyer_license})
                    {c.meeting_link && <> · <a href={c.meeting_link} target="_blank" rel="noopener noreferrer">رابط الاجتماع</a></>}</p>
                ) : c.status === "REQUESTED" ? <p className="small">الموعد المفضل: {fmt(c.preferred_at)} — بانتظار تأكيد فريق حصيف.</p> : null}
                {c.lawyer_summary && <p className="small">ملخص المحامي: {c.lawyer_summary}</p>}
                {c.cancel_reason && <p className="small muted">سبب الإلغاء: {c.cancel_reason}</p>}
                {(c.status === "REQUESTED" || c.status === "CONFIRMED") && (
                  <div><button className="link-btn danger" type="button" onClick={() => cancel(c)}>إلغاء الطلب</button></div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="small muted">الاستشارة تُقدَّم من محامين مرخّصين مستقلين عبر منصة حصيف، وتخضع لسرية العلاقة بين المحامي وموكله.</p>
    </>
  );
}
