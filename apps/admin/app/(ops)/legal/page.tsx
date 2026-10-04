"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CONSULT_MODE_LABEL, CONSULT_STATUS_LABEL, PAYMENT_STATUS_LABEL, minutesLabel, sarFmt,
  type AdminConsultation, type Lawyer, type LegalRate,
} from "@haseef/shared";
import { Dialog, fmtDateTime, useCan } from "@/components/ui";
import { api } from "@/lib/session";

type Tab = "requests" | "rates" | "lawyers";

export default function LegalAdmin() {
  const can = useCan();
  const [tab, setTab] = useState<Tab>("requests");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function act(fn: () => Promise<unknown>, ok: string, reload: () => void) {
    setError(null); setNotice(null);
    try { await fn(); setNotice(ok); reload(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "تعذّر التنفيذ"); return false; }
  }
  const tabs: [Tab, string, boolean][] = [
    ["requests", "طلبات الاستشارة", true],
    ["rates", "التسعيرة", true],
    ["lawyers", "المحامون", can("legal.cases", "legal.lawyers")],
  ];
  return (
    <>
      <h1>الاستشارات القانونية</h1>
      <p className="muted">تعيين المحامي وتأكيد الموعد، وتسجيل الدفع والأسعار، وقائمة المحامين: كلٌّ بحسب صلاحيات دورك.</p>
      <div className="filters" role="tablist">
        {tabs.filter(([, , ok]) => ok).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {tab === "requests" && <Requests act={act} />}
      {tab === "rates" && <Rates act={act} />}
      {tab === "lawyers" && <Lawyers act={act} />}
    </>
  );
}

type Act = (fn: () => Promise<unknown>, ok: string, reload: () => void) => Promise<boolean>;

function Requests({ act }: { act: Act }) {
  const can = useCan();
  const [rows, setRows] = useState<AdminConsultation[] | null>(null);
  const [lawyers, setLawyers] = useState<Lawyer[]>([]);
  const [assign, setAssign] = useState<AdminConsultation | null>(null);
  const [pay, setPay] = useState<AdminConsultation | null>(null);
  const load = useCallback(() => { api.admin.legalConsultations().then(setRows).catch(() => setRows([])); }, []);
  useEffect(() => { load(); if (can("legal.cases", "legal.lawyers")) api.admin.lawyers().then(setLawyers).catch(() => {}); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows) return null;
  return (
    <>
      <table className="table">
        <thead><tr><th>الطلب</th><th>المنشأة</th><th>الموعد</th><th className="num">الإجمالي</th><th>الحالة</th><th><span className="sr-only">إجراءات</span></th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={6} className="muted">لا طلبات.</td></tr>}
          {rows.map((c) => (
            <tr key={c.id}>
              <td><strong>{c.subject}</strong>
                <div className="muted small">{c.topic_title} · {minutesLabel(c.duration_minutes)} · {CONSULT_MODE_LABEL[c.mode]}{c.urgent ? " · عاجلة" : ""}</div>
                {c.details && <div className="small">{c.details}</div>}
                {c.lawyer_name && <div className="small">المحامي: {c.lawyer_name}</div>}</td>
              <td>{c.org_name}<div className="muted small">{c.requested_by_name ?? ""}</div></td>
              <td className="small">{c.status === "CONFIRMED" || c.status === "COMPLETED" ? fmtDateTime(c.scheduled_at) : <>مفضل: {fmtDateTime(c.preferred_at)}</>}</td>
              <td className="num">{sarFmt(c.total_sar)}</td>
              <td>
                <span className="pill" data-tone={c.status === "CONFIRMED" || c.status === "COMPLETED" ? "good" : c.status === "CANCELED" ? "bad" : "warn"}>{CONSULT_STATUS_LABEL[c.status]}</span>
                <div><span className="pill" data-tone={c.payment_status === "PAID" ? "good" : undefined}>{PAYMENT_STATUS_LABEL[c.payment_status]}</span></div>
                {c.payment_reference && <div className="muted small">{c.payment_reference}</div>}
              </td>
              <td className="row-actions-cell">
                {can("legal.cases") && (c.status === "REQUESTED" || c.status === "CONFIRMED") && <button className="link-btn" type="button" onClick={() => setAssign(c)}>{c.status === "REQUESTED" ? "تأكيد وتعيين" : "تعديل الموعد"}</button>}
                {can("legal.cases") && c.status === "CONFIRMED" && <button className="link-btn" type="button"
                  onClick={() => act(() => api.admin.legalComplete(c.id, window.prompt("ملخص المحامي للعميل (اختياري):") || null), "اكتملت الاستشارة", load)}>إكمال</button>}
                {can("legal.cases") && (c.status === "REQUESTED" || c.status === "CONFIRMED") && <button className="link-btn danger" type="button"
                  onClick={() => { const r = window.prompt("سبب الإلغاء:"); if (r && r.trim().length >= 3) act(() => api.admin.legalCancel(c.id, r.trim()), "أُلغي الطلب", load); }}>إلغاء</button>}
                {can("legal.billing") && c.status !== "CANCELED" && c.payment_status !== "PAID" && <button className="link-btn" type="button" onClick={() => setPay(c)}>تسجيل الدفع</button>}
                {can("legal.billing") && c.payment_status === "PAID" && c.status === "CANCELED" && <button className="link-btn" type="button"
                  onClick={() => { const r = window.prompt("مرجع الاسترداد:"); if (r && r.trim().length >= 2) act(() => api.admin.legalPayment(c.id, "REFUNDED", r.trim()), "سُجّل الاسترداد وصدر إشعار دائن بالفاتورة", load); }}>تسجيل استرداد</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Dialog open={!!assign} title="تأكيد الاستشارة وتعيين المحامي" onClose={() => setAssign(null)}>
        {assign && <AssignForm c={assign} lawyers={lawyers} onSave={(b) => act(() => api.admin.legalAssign(assign.id, b), "أُكّد الموعد وعُيّن المحامي", () => { setAssign(null); load(); })} />}
      </Dialog>
      <Dialog open={!!pay} title="تسجيل دفع الاستشارة" onClose={() => setPay(null)}>
        {pay && <PayForm c={pay} onSave={(ref) => act(() => api.admin.legalPayment(pay.id, "PAID", ref), "سُجّل الدفع وصدرت الفاتورة (المالية ← الفواتير)", () => { setPay(null); load(); })} />}
      </Dialog>
    </>
  );
}

function AssignForm({ c, lawyers, onSave }: { c: AdminConsultation; lawyers: Lawyer[]; onSave: (b: { lawyer_id: string; scheduled_at: string; meeting_link: string | null }) => void }) {
  const toLocal = (iso: string) => new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const fit = lawyers.filter((l) => l.is_active && l.specialties.includes(c.topic));
  const [v, setV] = useState({ lawyer_id: c.lawyer_id ?? fit[0]?.id ?? lawyers[0]?.id ?? "", at: toLocal(c.scheduled_at ?? c.preferred_at), link: c.meeting_link ?? "" });
  return (
    <form className="dialog-body" onSubmit={(e) => { e.preventDefault(); onSave({ lawyer_id: v.lawyer_id, scheduled_at: new Date(v.at).toISOString(), meeting_link: v.link || null }); }}>
      <p><strong>{c.subject}</strong> — {c.topic_title}، {minutesLabel(c.duration_minutes)}</p>
      <div className="field"><label>المحامي</label>
        <select required value={v.lawyer_id} onChange={(e) => setV({ ...v, lawyer_id: e.target.value })}>
          {lawyers.filter((l) => l.is_active).map((l) => <option key={l.id} value={l.id}>{l.full_name}{l.specialties.includes(c.topic) ? " ✓ متخصص" : ""}</option>)}
        </select></div>
      <div className="field"><label>الموعد</label><input type="datetime-local" required value={v.at} onChange={(e) => setV({ ...v, at: e.target.value })} /></div>
      {c.mode !== "IN_PERSON" && <div className="field"><label>رابط الاجتماع / رقم الاتصال</label><input dir="ltr" value={v.link} onChange={(e) => setV({ ...v, link: e.target.value })} /></div>}
      <div className="dialog-actions"><button className="btn btn-action" type="submit" disabled={!v.lawyer_id}>تأكيد</button></div>
    </form>
  );
}

function PayForm({ c, onSave }: { c: AdminConsultation; onSave: (ref: string) => void }) {
  const [ref, setRef] = useState("");
  return (
    <form className="dialog-body" onSubmit={(e) => { e.preventDefault(); onSave(ref.trim()); }}>
      <dl className="facts">
        <div><dt>الأساس</dt><dd>{sarFmt(c.price.base)}</dd></div>
        {c.price.urgent_fee > 0 && <div><dt>الاستعجال</dt><dd>{sarFmt(c.price.urgent_fee)}</dd></div>}
        {c.price.discount > 0 && <div><dt>خصم الباقة</dt><dd>− {sarFmt(c.price.discount)}</dd></div>}
        <div><dt>الضريبة</dt><dd>{sarFmt(c.price.vat)}</dd></div>
        <div><dt>الإجمالي</dt><dd>{sarFmt(c.total_sar)}</dd></div>
      </dl>
      <div className="field"><label>رقم الفاتورة / التحويل</label><input required minLength={2} value={ref} onChange={(e) => setRef(e.target.value)} /></div>
      <div className="dialog-actions"><button className="btn btn-action" type="submit">تسجيل الدفع</button></div>
    </form>
  );
}

function Rates({ act }: { act: Act }) {
  const can = useCan();
  const [rows, setRows] = useState<(LegalRate & { is_active: boolean })[] | null>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const load = useCallback(() => { api.admin.legalRates().then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);
  if (!rows) return null;
  const editor = can("legal.billing");
  return (
    <>
      {!editor && <p className="hint">تعديل الأسعار للمحاسبة والمدير العام.</p>}
      <table className="table">
        <thead><tr><th>المجال</th><th>الفئة</th><th className="num">سعر الساعة (ريال، قبل الضريبة)</th><th>الحالة</th><th><span className="sr-only">حفظ</span></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.topic}>
              <td><strong>{r.title}</strong>{r.description && <div className="muted small">{r.description}</div>}</td>
              <td>{r.tier === "SPECIALIZED" ? "متخصصة" : "عامة"}</td>
              <td className="num">{editor
                ? <input type="number" min={1} step="10" style={{ width: 110 }} value={edit[r.topic] ?? String(r.hourly_rate_sar)} onChange={(e) => setEdit({ ...edit, [r.topic]: e.target.value })} />
                : Number(r.hourly_rate_sar).toLocaleString("en-US")}</td>
              <td><span className="pill" data-tone={r.is_active ? "good" : undefined}>{r.is_active ? "متاح" : "موقوف"}</span></td>
              <td className="row-actions-cell">{editor && <>
                <button className="link-btn" type="button" onClick={() => act(() => api.admin.legalSetRate(r.topic, Number(edit[r.topic] ?? r.hourly_rate_sar), r.is_active), "حُفظ السعر", load)}>حفظ</button>
                <button className="link-btn" type="button" onClick={() => act(() => api.admin.legalSetRate(r.topic, Number(r.hourly_rate_sar), !r.is_active), r.is_active ? "أُوقف المجال" : "أُتيح المجال", load)}>{r.is_active ? "إيقاف" : "إتاحة"}</button>
              </>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">الخصومات ثابتة: باقة الحوكمة والنمو 15%، كبار العملاء 25%. الاستعجال +30%. تُضاف ضريبة القيمة المضافة 15%. السعر يُجمَّد في الطلب وقت إرساله.</p>
    </>
  );
}

const TOPICS: Record<string, string> = {
  CORPORATE: "الشركات والحوكمة", CONTRACTS: "العقود", LABOR: "العمل", PDPL: "حماية البيانات",
  COMPLIANCE: "الامتثال", RESTRUCTURING: "إعادة الهيكلة", DISPUTES: "النزاعات",
};

function Lawyers({ act }: { act: Act }) {
  const can = useCan();
  const [rows, setRows] = useState<Lawyer[] | null>(null);
  const [edit, setEdit] = useState<Lawyer | null>(null);
  const load = useCallback(() => { api.admin.lawyers().then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);
  if (!rows) return null;
  const admin = can("legal.lawyers");
  const blank: Lawyer = { id: "", full_name: "", license_number: "", specialties: [], bio: null, email: null, phone_number: null, is_active: true };
  return (
    <>
      {admin ? <div className="head-row"><span /><button className="btn btn-action" type="button" onClick={() => setEdit(blank)}>إضافة محامٍ</button></div>
        : <p className="hint">إضافة المحامين وتعديلهم تتطلب صلاحية إدارة المحامين.</p>}
      <table className="table">
        <thead><tr><th>المحامي</th><th>الترخيص</th><th>التخصصات</th><th>الحالة</th><th><span className="sr-only">إجراءات</span></th></tr></thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id}>
              <td><strong>{l.full_name}</strong>{l.bio && <div className="muted small">{l.bio}</div>}</td>
              <td><bdi dir="ltr">{l.license_number}</bdi></td>
              <td className="small">{l.specialties.map((s) => TOPICS[s] ?? s).join("، ")}</td>
              <td><span className="pill" data-tone={l.is_active ? "good" : undefined}>{l.is_active ? "متاح" : "موقوف"}</span></td>
              <td className="row-actions-cell">{admin && <button className="link-btn" type="button" onClick={() => setEdit(l)}>تعديل</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Dialog open={!!edit} title={edit?.id ? "تعديل محامٍ" : "إضافة محامٍ"} onClose={() => setEdit(null)}>
        {edit && <LawyerForm init={edit} onSave={(v) => {
          const { id: _id, ...body } = v;
          act(() => edit.id ? api.admin.updateLawyer(edit.id, body) : api.admin.addLawyer(body), "حُفظ المحامي", () => { setEdit(null); load(); });
        }} />}
      </Dialog>
    </>
  );
}

function LawyerForm({ init, onSave }: { init: Lawyer; onSave: (v: Lawyer) => void }) {
  const [v, setV] = useState<Lawyer>(init);
  return (
    <form className="dialog-body" onSubmit={(e) => { e.preventDefault(); onSave(v); }}>
      <div className="field"><label>الاسم</label><input required minLength={3} value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} /></div>
      <div className="field"><label>رقم الترخيص المهني</label><input required dir="ltr" value={v.license_number} onChange={(e) => setV({ ...v, license_number: e.target.value })} /></div>
      <fieldset className="field"><legend className="small">التخصصات</legend>
        <div className="role-legend">{Object.entries(TOPICS).map(([k, l]) => (
          <label key={k} className="small"><input type="checkbox" checked={v.specialties.includes(k)}
            onChange={(e) => setV({ ...v, specialties: e.target.checked ? [...v.specialties, k] : v.specialties.filter((x) => x !== k) })} /> {l}</label>))}</div>
      </fieldset>
      <div className="field"><label>نبذة</label><input value={v.bio ?? ""} onChange={(e) => setV({ ...v, bio: e.target.value || null })} /></div>
      <div className="field"><label>البريد</label><input dir="ltr" type="email" value={v.email ?? ""} onChange={(e) => setV({ ...v, email: e.target.value || null })} /></div>
      <div className="field"><label>الجوال</label><input dir="ltr" pattern="\+9665\d{8}" placeholder="+9665XXXXXXXX" value={v.phone_number ?? ""} onChange={(e) => setV({ ...v, phone_number: e.target.value || null })} /></div>
      <label className="small"><input type="checkbox" checked={v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} /> متاح لاستقبال الاستشارات</label>
      <div className="dialog-actions"><button className="btn btn-action" type="submit">حفظ</button></div>
    </form>
  );
}
