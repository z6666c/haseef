"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  CHANNEL_LABEL, DATA_SUBJECTS_LABEL, DSR_STATUS_LABEL, DSR_TYPE_LABEL, INCIDENT_STATUS_LABEL, LEGAL_BASIS_LABEL,
  SEVERITY_LABEL, STORAGE_LABEL,
  type DataRequest, type DataRequestInput, type Incident, type IncidentInput, type PdplOverview, type RopaInput, type RopaRecord,
} from "@haseef/shared";
import { api } from "@/lib/session";

type Tab = "ropa" | "requests" | "incidents";
const fmt = (d: string | null, time = false) => d
  ? new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", time ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(new Date(d))
  : "—";
const today = () => new Date().toISOString().slice(0, 10);
const splitList = (s: string) => s.split(/[،,\n]/).map((x) => x.trim()).filter(Boolean);

export default function PdplPage() {
  const [tab, setTab] = useState<Tab>("ropa");
  const [ov, setOv] = useState<PdplOverview | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => { api.pdplSummary().then(setOv).catch(() => {}); setTick((n) => n + 1); }, []);
  useEffect(() => {
    api.dashboard().then((d) => setAvailable(d.pdpl.available)).catch(() => setAvailable(true));
    reload();
  }, [reload]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setError(null); setNotice(null);
    try { await fn(); setNotice(ok); reload(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "تعذّر التنفيذ"); return false; }
  }

  return (
    <>
      <header className="page-head">
        <h1>حماية البيانات الشخصية</h1>
        <p className="muted">سجل أنشطة المعالجة، وطلبات أصحاب البيانات بمهلة الرد، وحوادث التسرب بعدّاد الإبلاغ خلال {ov?.notify_hours ?? 72} ساعة.</p>
      </header>
      {available === false && (
        <p className="hint-box">وحدة حماية البيانات ضمن باقة الحوكمة والنمو. تقدر تستخدمها الآن، لكنها لا تدخل في مؤشرك حتى ترقّي الباقة.</p>
      )}

      {ov && (
        <dl className="obl-stats pdpl-stats">
          <div><dt>أنشطة معالجة موثقة</dt><dd data-s={ov.records.n ? "IN_PLACE" : "PENDING"}>{ov.records.n}</dd></div>
          <div><dt>طلبات مفتوحة</dt><dd>{ov.requests.open}{ov.requests.overdue > 0 && <small className="late"> ({ov.requests.overdue} متأخر)</small>}</dd></div>
          <div><dt>حوادث مفتوحة</dt><dd data-s={ov.incidents.notify_overdue ? "LATE" : undefined}>{ov.incidents.open}
            {ov.incidents.notify_overdue > 0 && <small className="late"> (تجاوزت مهلة الإبلاغ)</small>}</dd></div>
        </dl>
      )}

      <div className="filters" role="tablist">
        {([["ropa", "سجل أنشطة المعالجة"], ["requests", "طلبات أصحاب البيانات"], ["incidents", "حوادث التسرب"]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {tab === "ropa" && <RopaTab key={tick} act={act} />}
      {tab === "requests" && <RequestsTab key={tick} act={act} days={ov?.request_days ?? 30} />}
      {tab === "incidents" && <IncidentsTab key={tick} act={act} hours={ov?.notify_hours ?? 72} />}
    </>
  );
}

type Act = (fn: () => Promise<unknown>, ok: string) => Promise<boolean>;

// ------------------------------------------------------------------ سجل الأنشطة
const EMPTY_ROPA: RopaInput = {
  activity_name: "", purpose: "", data_subjects: "CUSTOMERS", data_categories: [], includes_sensitive_data: false,
  legal_basis: "CONTRACTUAL", owner_membership_id: null, retention_period_months: 24, storage_location: "SAUDI_LOCAL_CLOUD",
  cross_border_transfer: false, transfer_destination: null, transfer_safeguard: null, processors: [], security_controls: null,
  next_review_date: null,
};

function RopaTab({ act }: { act: Act }) {
  const [rows, setRows] = useState<RopaRecord[] | null>(null);
  const [tpls, setTpls] = useState<{ key: string; activity_name: string }[]>([]);
  const [owners, setOwners] = useState<{ id: string; full_name: string }[]>([]);
  const [edit, setEdit] = useState<{ id: string | null; v: RopaInput } | null>(null);

  useEffect(() => {
    api.ropa().then(setRows).catch(() => setRows([]));
    api.ropaTemplates().then(setTpls).catch(() => {});
    api.ropaOwners().then(setOwners).catch(() => {});
  }, []);
  if (!rows) return <div className="boot" aria-busy="true" />;
  const have = new Set(rows.map((r) => r.activity_name));

  return (
    <section className="gov-section" style={{ marginTop: 8 }}>
      {rows.length === 0 && (
        <p className="hint-box">السجل فارغ، وهذا من الفجوات الإلزامية في فحص الحوكمة. أضف أنشطتك من الأمثلة الشائعة تحت بنقرة، ثم عدّل التفاصيل.</p>
      )}
      <div className="example-box">
        <div><strong>أضف نشاطاً شائعاً بنقرة:</strong>
          <p className="muted small">كل مثال معبأ بالغرض والفئات والأساس النظامي ومدة الحفظ والضوابط كما يكتبها مسؤول حماية بيانات.</p></div>
        <div className="chip-row">
          {tpls.map((t) => (
            <button key={t.key} type="button" className="chip" disabled={have.has(t.activity_name)}
                    onClick={() => act(() => api.addRopaFromTemplate(t.key), `أُضيف: ${t.activity_name}`)}>
              {have.has(t.activity_name) ? "✓ " : "+ "}{t.activity_name}
            </button>
          ))}
        </div>
      </div>
      <div className="head-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>الأنشطة ({rows.length})</h2>
        <button className="btn btn-quiet" type="button" onClick={() => setEdit({ id: null, v: { ...EMPTY_ROPA } })}>+ نشاط جديد</button>
      </div>
      {edit && <RopaForm init={edit.v} owners={owners} onCancel={() => setEdit(null)}
        onSave={async (v) => { if (await act(() => edit.id ? api.updateRopa(edit.id, v) : api.addRopa(v), "حُفظ النشاط")) setEdit(null); }} />}
      <ul className="ropa-list">
        {rows.map((r) => (
          <li key={r.id}>
            <div className="res-head">
              <strong>{r.activity_name}</strong>
              <span className="tag">{DATA_SUBJECTS_LABEL[r.data_subjects]}</span>
              <span className="tag tag-quiet">{LEGAL_BASIS_LABEL[r.legal_basis]}</span>
              {r.includes_sensitive_data && <span className="draft-badge">بيانات حساسة</span>}
              {r.cross_border_transfer && <span className="risk" data-r="HIGH">نقل خارج المملكة</span>}
            </div>
            <p>{r.purpose}</p>
            <dl className="ropa-facts">
              <div><dt>الفئات</dt><dd>{r.data_categories.join("، ")}</dd></div>
              <div><dt>الحفظ</dt><dd>{r.retention_period_months} شهراً · {STORAGE_LABEL[r.storage_location]}</dd></div>
              <div><dt>المسؤول</dt><dd>{r.owner_name ?? <span className="late">غير محدد</span>}</dd></div>
              {r.processors.length > 0 && <div><dt>المعالجون</dt><dd>{r.processors.join("، ")}</dd></div>}
              {r.cross_border_transfer && <div><dt>النقل</dt><dd>{r.transfer_destination} — {r.transfer_safeguard}</dd></div>}
              <div><dt>المراجعة القادمة</dt><dd>{fmt(r.next_review_date)}</dd></div>
            </dl>
            <div className="row-actions-cell" style={{ textAlign: "start" }}>
              <button className="link-btn" type="button" onClick={() => setEdit({ id: r.id, v: { ...r } })}>تعديل</button>
              <button className="link-btn danger" type="button"
                      onClick={() => { if (window.confirm(`حذف «${r.activity_name}» من السجل؟`)) act(() => api.deleteRopa(r.id), "حُذف النشاط"); }}>حذف</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RopaForm({ init, owners, onSave, onCancel }: {
  init: RopaInput; owners: { id: string; full_name: string }[]; onSave: (v: RopaInput) => void; onCancel: () => void;
}) {
  const [v, setV] = useState<RopaInput>(init);
  const [cats, setCats] = useState(init.data_categories.join("، "));
  const [procs, setProcs] = useState(init.processors.join("، "));
  const set = <K extends keyof RopaInput>(k: K, val: RopaInput[K]) => setV({ ...v, [k]: val });
  return (
    <form className="panel inline-form" onSubmit={(e) => { e.preventDefault(); onSave({ ...v, data_categories: splitList(cats), processors: splitList(procs) }); }}>
      <div className="grid">
        <div className="field"><label>اسم النشاط</label><input required minLength={2} value={v.activity_name} onChange={(e) => set("activity_name", e.target.value)} /></div>
        <div className="field"><label>أصحاب البيانات</label>
          <select value={v.data_subjects} onChange={(e) => set("data_subjects", e.target.value)}>
            {Object.entries(DATA_SUBJECTS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div className="field"><label>الأساس النظامي</label>
          <select value={v.legal_basis} onChange={(e) => set("legal_basis", e.target.value)}>
            {Object.entries(LEGAL_BASIS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div className="field"><label>المسؤول عن النشاط</label>
          <select value={v.owner_membership_id ?? ""} onChange={(e) => set("owner_membership_id", e.target.value || null)}>
            <option value="">غير محدد</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.full_name}</option>)}</select></div>
        <div className="field"><label>مدة الحفظ (أشهر)</label>
          <input type="number" min={1} max={600} required value={v.retention_period_months} onChange={(e) => set("retention_period_months", Number(e.target.value))} /></div>
        <div className="field"><label>مكان التخزين</label>
          <select value={v.storage_location} onChange={(e) => set("storage_location", e.target.value)}>
            {Object.entries(STORAGE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div className="field"><label>المراجعة القادمة</label>
          <input type="date" value={v.next_review_date ?? ""} onChange={(e) => set("next_review_date", e.target.value || null)} /></div>
        <div className="field field-wide"><label>الغرض</label><textarea rows={2} required value={v.purpose} onChange={(e) => set("purpose", e.target.value)} /></div>
        <div className="field field-wide"><label>فئات البيانات (افصل بفاصلة)</label><input required value={cats} onChange={(e) => setCats(e.target.value)} /></div>
        <div className="field field-wide"><label>المعالجون من أطراف ثالثة (افصل بفاصلة)</label><input value={procs} onChange={(e) => setProcs(e.target.value)} /></div>
        <div className="field field-wide"><label>ضوابط الحماية</label><textarea rows={2} value={v.security_controls ?? ""} onChange={(e) => set("security_controls", e.target.value || null)} /></div>
      </div>
      <div className="checks">
        <label><input type="checkbox" checked={v.includes_sensitive_data} onChange={(e) => set("includes_sensitive_data", e.target.checked)} /> يتضمن بيانات حساسة (صحية، مالية، دينية…)</label>
        <label><input type="checkbox" checked={v.cross_border_transfer} onChange={(e) => set("cross_border_transfer", e.target.checked)} /> تُنقل البيانات خارج المملكة</label>
      </div>
      {v.cross_border_transfer && (
        <div className="grid">
          <div className="field"><label>الوجهة</label><input required value={v.transfer_destination ?? ""} onChange={(e) => set("transfer_destination", e.target.value)} /></div>
          <div className="field"><label>الأساس النظامي للنقل</label><input required value={v.transfer_safeguard ?? ""} onChange={(e) => set("transfer_safeguard", e.target.value)} /></div>
        </div>
      )}
      <div className="actions"><button className="btn btn-action" type="submit">حفظ</button><button className="btn btn-quiet" type="button" onClick={onCancel}>إلغاء</button></div>
    </form>
  );
}

// ------------------------------------------------------------------ طلبات أصحاب البيانات
function RequestsTab({ act, days }: { act: Act; days: number }) {
  const [rows, setRows] = useState<DataRequest[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState<DataRequestInput>({ requester_name: "", requester_contact: null, request_type: "ACCESS", channel: "EMAIL", details: null, received_on: today() });
  useEffect(() => { api.dsr().then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return <div className="boot" aria-busy="true" />;
  return (
    <section className="gov-section" style={{ marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <p className="muted" style={{ margin: 0 }}>كل طلب له مهلة رد {days} يوماً من الاستلام افتراضياً. تحقّق من هوية مقدم الطلب قبل التنفيذ.</p>
        <button className="btn btn-quiet" type="button" onClick={() => setAdding(!adding)}>+ تسجيل طلب</button>
      </div>
      {adding && (
        <form className="panel inline-form" onSubmit={async (e) => { e.preventDefault(); if (await act(() => api.addDsr(f), "سُجّل الطلب")) setAdding(false); }}>
          <div className="grid">
            <div className="field"><label>مقدم الطلب</label><input required minLength={2} value={f.requester_name} onChange={(e) => setF({ ...f, requester_name: e.target.value })} /></div>
            <div className="field"><label>وسيلة التواصل</label><input value={f.requester_contact ?? ""} onChange={(e) => setF({ ...f, requester_contact: e.target.value || null })} /></div>
            <div className="field"><label>نوع الطلب</label><select value={f.request_type} onChange={(e) => setF({ ...f, request_type: e.target.value })}>
              {Object.entries(DSR_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div className="field"><label>القناة</label><select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>
              {Object.entries(CHANNEL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div className="field"><label>تاريخ الاستلام</label><input type="date" required value={f.received_on} onChange={(e) => setF({ ...f, received_on: e.target.value })} /></div>
            <div className="field field-wide"><label>التفاصيل</label><textarea rows={2} value={f.details ?? ""} onChange={(e) => setF({ ...f, details: e.target.value || null })} /></div>
          </div>
          <div className="actions"><button className="btn btn-action" type="submit">تسجيل</button></div>
        </form>
      )}
      {rows.length === 0 ? <p className="empty">لا طلبات مسجلة.</p> : (
        <ul className="ropa-list">
          {rows.map((r) => {
            const open = r.status === "OPEN" || r.status === "IN_PROGRESS";
            return (
              <li key={r.id}>
                <div className="res-head">
                  <strong>{r.requester_name}</strong>
                  <span className="tag">{DSR_TYPE_LABEL[r.request_type]}</span>
                  <span className="tag tag-quiet">{CHANNEL_LABEL[r.channel]}</span>
                  <span className="status-chip" data-s={open ? (r.days_left < 0 ? "AT_RISK" : "PENDING") : "IN_PLACE"}>{DSR_STATUS_LABEL[r.status]}</span>
                  {open && <span className={r.days_left < 0 ? "late small" : "small muted"}>{r.days_left < 0 ? `متأخر ${-r.days_left} يوماً` : `باقي ${r.days_left} يوماً`}</span>}
                </div>
                {r.details && <p>{r.details}</p>}
                <p className="small muted">استُلم {fmt(r.received_on)} · المهلة {fmt(r.due_on)}{r.completed_on ? ` · أُغلق ${fmt(r.completed_on)}` : ""}</p>
                {r.response_note && <p className="small">الرد: {r.response_note}</p>}
                {open && <DsrActions r={r} act={act} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function DsrActions({ r, act }: { r: DataRequest; act: Act }) {
  const [verified, setVerified] = useState(r.identity_verified);
  const [note, setNote] = useState("");
  const send = (status: string, ok: string) => act(() => api.updateDsr(r.id, { status, identity_verified: verified, response_note: note || null }), ok);
  return (
    <div className="dsr-actions">
      <label className="small"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} /> تم التحقق من الهوية</label>
      <input className="search" placeholder="ملخص الرد (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} />
      {r.status === "OPEN" && <button className="btn btn-quiet" type="button" onClick={() => send("IN_PROGRESS", "الطلب قيد المعالجة")}>بدء المعالجة</button>}
      <button className="btn btn-action" type="button" disabled={!verified} onClick={() => send("COMPLETED", "أُغلق الطلب بالتنفيذ")}>نُفّذ</button>
      <button className="link-btn danger" type="button" onClick={() => send("REJECTED", "أُغلق الطلب بالرفض")}>رفض مسبب</button>
    </div>
  );
}

// ------------------------------------------------------------------ حوادث التسرب
function hoursLeft(deadline: string) { return Math.round((new Date(deadline).getTime() - Date.now()) / 36e5); }

function IncidentsTab({ act, hours }: { act: Act; hours: number }) {
  const [rows, setRows] = useState<Incident[] | null>(null);
  const [adding, setAdding] = useState(false);
  const nowLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [f, setF] = useState<IncidentInput>({ title: "", description: null, discovered_at: nowLocal(), occurred_at: null, data_categories: [], subjects_affected: null, severity: "MEDIUM", harm_likely: true });
  const [cats, setCats] = useState("");
  useEffect(() => { api.incidents().then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return <div className="boot" aria-busy="true" />;
  return (
    <section className="gov-section" style={{ marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <p className="muted" style={{ margin: 0 }}>سجّل الحادثة فور العلم بها: يبدأ عدّاد الإبلاغ ({hours} ساعة) من وقت الاكتشاف. الإجراء التفصيلي في{" "}
          <Link href="/library">نموذج إجراء الاستجابة لتسرب البيانات</Link>.</p>
        <button className="btn btn-danger-soft" type="button" onClick={() => setAdding(!adding)}>+ تسجيل حادثة</button>
      </div>
      {adding && (
        <form className="panel inline-form" onSubmit={async (e) => {
          e.preventDefault();
          const body = { ...f, data_categories: splitList(cats), discovered_at: new Date(f.discovered_at).toISOString(),
                         occurred_at: f.occurred_at ? new Date(f.occurred_at).toISOString() : null };
          if (await act(() => api.addIncident(body), "سُجّلت الحادثة وبدأ عدّاد الإبلاغ")) setAdding(false);
        }}>
          <div className="grid">
            <div className="field field-wide"><label>وصف مختصر</label><input required minLength={3} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
            <div className="field"><label>وقت الاكتشاف</label><input type="datetime-local" required value={f.discovered_at} onChange={(e) => setF({ ...f, discovered_at: e.target.value })} /></div>
            <div className="field"><label>وقت الوقوع (إن عُرف)</label><input type="datetime-local" value={f.occurred_at ?? ""} onChange={(e) => setF({ ...f, occurred_at: e.target.value || null })} /></div>
            <div className="field"><label>الخطورة</label><select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value as IncidentInput["severity"] })}>
              {Object.entries(SEVERITY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div className="field"><label>عدد المتأثرين (تقديري)</label><input type="number" min={0} value={f.subjects_affected ?? ""} onChange={(e) => setF({ ...f, subjects_affected: e.target.value === "" ? null : Number(e.target.value) })} /></div>
            <div className="field field-wide"><label>فئات البيانات المتأثرة (افصل بفاصلة)</label><input value={cats} onChange={(e) => setCats(e.target.value)} /></div>
            <div className="field field-wide"><label>التفاصيل</label><textarea rows={2} value={f.description ?? ""} onChange={(e) => setF({ ...f, description: e.target.value || null })} /></div>
          </div>
          <label className="small"><input type="checkbox" checked={f.harm_likely} onChange={(e) => setF({ ...f, harm_likely: e.target.checked })} /> يُحتمل أن تُلحق ضرراً بأصحاب البيانات (يوجب الإبلاغ)</label>
          <div className="actions"><button className="btn btn-action" type="submit">تسجيل</button></div>
        </form>
      )}
      {rows.length === 0 ? <p className="empty">لا حوادث مسجلة.</p> : (
        <ul className="ropa-list">
          {rows.map((i) => {
            const h = hoursLeft(i.notify_deadline);
            const needs = i.harm_likely && !i.authority_notified_at && i.status !== "CLOSED";
            return (
              <li key={i.id} data-s={needs && h < 0 ? "late" : undefined}>
                <div className="res-head">
                  <strong>{i.title}</strong>
                  <span className="risk" data-r={i.severity === "HIGH" ? "CRITICAL" : i.severity === "MEDIUM" ? "HIGH" : undefined}>{SEVERITY_LABEL[i.severity]}</span>
                  <span className="status-chip" data-s={i.status === "CLOSED" ? "IN_PLACE" : "PENDING"}>{INCIDENT_STATUS_LABEL[i.status]}</span>
                </div>
                {needs && (
                  <p className={h < 0 ? "countdown late" : "countdown"}>
                    {h < 0 ? `تجاوزت مهلة إبلاغ الجهة المختصة بـ ${-h} ساعة — أبلغ فوراً` : `باقي ${h} ساعة لإبلاغ الجهة المختصة`}
                  </p>
                )}
                {i.description && <p>{i.description}</p>}
                <p className="small muted">اكتُشفت {fmt(i.discovered_at, true)}{i.subjects_affected != null ? ` · المتأثرون ${i.subjects_affected}` : ""}
                  {i.data_categories.length ? ` · ${i.data_categories.join("، ")}` : ""}</p>
                {i.authority_notified_at && <p className="small tracked">أُبلغت الجهة المختصة {fmt(i.authority_notified_at, true)}{i.subjects_notified_at ? ` · أُشعر المتأثرون ${fmt(i.subjects_notified_at, true)}` : ""}</p>}
                {i.root_cause && <p className="small">السبب: {i.root_cause}</p>}
                {i.actions_taken && <p className="small">الإجراءات: {i.actions_taken}</p>}
                {i.status !== "CLOSED" && <IncidentActions i={i} act={act} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function IncidentActions({ i, act }: { i: Incident; act: Act }) {
  const [cause, setCause] = useState(i.root_cause ?? "");
  const [actions, setActions] = useState(i.actions_taken ?? "");
  const now = () => new Date().toISOString();
  const upd = (b: Record<string, unknown>, ok: string) => act(() => api.updateIncident(i.id, { status: i.status, root_cause: cause || null, actions_taken: actions || null, ...b }), ok);
  return (
    <div className="inline-form" style={{ marginTop: 8 }}>
      <div className="grid">
        <div className="field"><label>السبب الجذري</label><input value={cause} onChange={(e) => setCause(e.target.value)} /></div>
        <div className="field"><label>الإجراءات المتخذة</label><input value={actions} onChange={(e) => setActions(e.target.value)} /></div>
      </div>
      <div className="dsr-actions">
        {i.status === "OPEN" && <button className="btn btn-quiet" type="button" onClick={() => upd({ status: "CONTAINED" }, "سُجّل احتواء الحادثة")}>تم الاحتواء</button>}
        {!i.authority_notified_at && <button className="btn btn-action" type="button" onClick={() => upd({ status: "REPORTED", authority_notified_at: now() }, "سُجّل إبلاغ الجهة المختصة")}>أُبلغت الجهة المختصة الآن</button>}
        {!i.subjects_notified_at && <button className="btn btn-quiet" type="button" onClick={() => upd({ subjects_notified_at: now() }, "سُجّل إشعار المتأثرين")}>أُشعر المتأثرون</button>}
        {!i.harm_likely || i.authority_notified_at
          ? <button className="link-btn" type="button" onClick={() => upd({ status: "CLOSED" }, "أُغلقت الحادثة")}>إغلاق الحادثة</button>
          : <button className="link-btn" type="button" onClick={() => upd({ harm_likely: false }, "سُجّل أن الحادثة لا يُحتمل أن تُلحق ضرراً")}>لا يُحتمل ضرر (لا يلزم الإبلاغ)</button>}
      </div>
    </div>
  );
}
