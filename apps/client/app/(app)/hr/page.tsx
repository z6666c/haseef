"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  KIND_LABEL, LEAVE_LABEL, PAY_MODE_LABEL, LEAVE_STATUS, LEAVE_TYPES, NOTICE_STATUS, fmtDays, formatDate, sar,
  type DeductionKind, type PayMode, type DeductionSuggestion, type HrDeductions, type HrOverview, type LeaveAttachment, type LeaveRow, type LeaveType,
} from "@haseef/shared";
import { AttachPicker } from "@/components/AttachPicker";
import { api } from "@/lib/session";

type Tab = "requests" | "balances" | "deductions" | "settings";
type Act = (fn: () => Promise<unknown>, ok: string) => Promise<boolean>;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
const SRC: Record<string, string> = { LINK: "من رابط الموظف", BOT: "من واتساب", HR: "أدخلتها الموارد البشرية" };
const CHIP: Record<string, string> = { PENDING: "PENDING", APPROVED: "IN_PLACE", REJECTED: "FAIL", CANCELLED: "EXPIRED", ISSUED: "PENDING", OBJECTED: "LATE", CONFIRMED: "IN_PLACE" };

export default function HrPage() {
  const [ov, setOv] = useState<HrOverview | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("requests");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.hrOverview().then(setOv).catch((e: Error & { status?: number }) => (e.status === 402 ? setDenied(e.message) : setError(e.message)));
  }, []);
  useEffect(load, [load]);
  const act: Act = async (fn, ok) => {
    setError(null); setNotice(null);
    try { await fn(); setNotice(ok); load(); return true; } catch (e) { setError(e instanceof Error ? e.message : "تعذّر"); return false; }
  };

  if (denied) {
    return (
      <>
        <header className="page-head"><h1>الإجازات والخصومات</h1></header>
        <section className="panel inline-form" style={{ maxWidth: 680 }}>
          <p>نظام موارد بشرية متكامل مع الحضور بالموقع: الموظف يرفع إجازته (سنوية، اعتيادية، اضطرارية، مرضية) من جواله أو من واتساب، ويسجّل مباشرته بعد العودة،
            وتصله إشعارات الخصم مع حقه في الاعتراض.</p>
          <ul className="labor-rules">
            <li>أرصدة تلقائية: 21 يوماً، و30 بعد خمس سنوات خدمة.</li>
            <li>الإجازة المرضية بشرائح الأجر وفق المادة 117.</li>
            <li>اقتراح خصومات التأخير والغياب والتأخر عن المباشرة من سجل الحضور، مع التحقق من سقوف نظام العمل.</li>
          </ul>
          <p className="hint-box">{denied}</p>
          <Link className="btn btn-action" href="/billing">اشترك في الإضافة</Link>
        </section>
      </>
    );
  }
  if (!ov) return error ? <p className="error">{error}</p> : <div className="boot" aria-busy="true" />;

  return (
    <>
      <header className="page-head">
        <h1>الإجازات والخصومات</h1>
        <p className="muted">طلبات الإجازة والمباشرة وأرصدة الموظفين وإشعارات الخصم. الموظف يرفع طلبه من رابطه الشخصي أو بكتابة «إجازة» لمساعد واتساب.</p>
      </header>
      {ov.access.via === "ADDON" && ov.access.paid_until && (() => {
        const d = Math.ceil((new Date(ov.access.paid_until).getTime() - Date.now()) / 86_400_000);
        return d <= 5 ? <p className="hint-box">اشتراك الموارد البشرية ينتهي {d <= 0 ? "اليوم" : d === 1 ? "غداً" : `بعد ${d} أيام`} ({formatDate(ov.access.paid_until.slice(0, 10))}).
          بعده تتوقف طلبات الإجازة وإشعارات الخصم وتبقى البيانات محفوظة. {ov.can_manage && <Link href="/billing">اشترك أو جدّد الآن</Link>}</p> : null;
      })()}
      <dl className="obl-stats labor-stats">
        <div><dt>بانتظار قرارك</dt><dd data-s={ov.stats.pending ? "PENDING" : undefined}>{ov.stats.pending}</dd></div>
        <div><dt>في إجازة الآن</dt><dd>{ov.stats.on_leave}</dd></div>
        <div><dt>لم تُؤكَّد مباشرتهم</dt><dd data-s={ov.stats.awaiting_return ? "LATE" : undefined}>{ov.stats.awaiting_return}</dd></div>
        <div><dt>الموظفون</dt><dd>{ov.people.length}</dd></div>
      </dl>
      <div className="tabs-row">
        <div className="filters" role="tablist">
          {([["requests", "الطلبات والمباشرة"], ["balances", "الأرصدة"], ["deductions", "الخصومات"], ["settings", "السياسات والإعدادات"]] as [Tab, string][]).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>))}
        </div>
      </div>
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {tab === "requests" && <RequestsTab ov={ov} act={act} />}
      {tab === "balances" && <BalancesTab ov={ov} act={act} />}
      {tab === "deductions" && <DeductionsTab ov={ov} act={act} />}
      {tab === "settings" && <SettingsTab ov={ov} act={act} />}
    </>
  );
}

/** فتح التقرير الطبي: يُنزَّل بتوكن المستخدم (بيانات صحية لمدير المنشأة ومسؤول الامتثال فقط، ويُسجَّل الاطلاع). */
function ViewAttachment({ l }: { l: LeaveRow }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function open() {
    setBusy(true); setErr(null);
    const w = window.open("", "_blank");
    try {
      const url = URL.createObjectURL(await api.hrLeaveAttachment(l.id));
      if (w) w.location.href = url; else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { w?.close(); setErr(e instanceof Error ? e.message : "تعذّر فتح المرفق"); } finally { setBusy(false); }
  }
  return <div><button className="link-btn small" type="button" disabled={busy} onClick={open}>📎 {busy ? "جارٍ الفتح…" : "عرض التقرير الطبي"}</button>
    {err && <div className="error small">{err}</div>}</div>;
}

function LeaveCells({ l, canView }: { l: LeaveRow; canView: boolean }) {
  return (
    <>
      <td><b>{l.full_name}</b><div className="small muted">{SRC[l.source]}</div></td>
      <td>{l.label}{l.is_paid === false && <span className="tag tag-quiet">بدون أجر</span>}<div className="small muted">{l.days} يوم{l.pay_note ? ` · ${l.pay_note}` : ""}</div>{l.medical_ref && <div className="small muted">رقم التقرير: {l.medical_ref}</div>}
        {l.has_attachment ? (canView ? <ViewAttachment l={l} /> : <div className="small muted">📎 تقرير مرفق</div>)
          : l.leave_type === "SICK" && <div className="small" style={{ color: "var(--amber, #b45309)" }}>بلا تقرير مرفق</div>}</td>
      <td className="small">{formatDate(l.start_date)} ← {formatDate(l.end_date)}{l.reason && <div className="muted">{l.reason}</div>}</td>
    </>
  );
}

function RequestsTab({ ov, act }: { ov: HrOverview; act: Act }) {
  const canChoose = (l: LeaveRow) => ov.policies.find((p) => p.leave_type === l.leave_type)?.pay_mode === "CHOICE";
  const [adding, setAdding] = useState(false);
  const [decide, setDecide] = useState<{ l: LeaveRow; approve: boolean } | null>(null);
  const [dPaid, setDPaid] = useState(true);
  const [note, setNote] = useState("");
  const pending = ov.leaves.filter((l) => l.status === "PENDING");
  const returns = ov.leaves.filter((l) => l.awaiting_return || (l.return_submitted_at && !l.return_confirmed_at));
  const current = ov.leaves.filter((l) => l.on_leave_now);
  const history = ov.leaves.filter((l) => l.status !== "PENDING" && !l.on_leave_now && !returns.includes(l)).slice(0, 40);
  return (
    <section className="gov-section" style={{ marginTop: 8 }}>
      {ov.can_manage && !adding && <button className="btn" type="button" onClick={() => setAdding(true)}>إدخال إجازة لموظف</button>}
      {adding && <AddLeave ov={ov} act={act} onDone={() => setAdding(false)} />}

      <h2 style={{ marginTop: 16 }}>بانتظار قرارك</h2>
      {pending.length === 0 ? <p className="muted small">لا طلبات معلقة.</p> : (
        <table className="deadlines labor-table">
          <thead><tr><th>الموظف</th><th>النوع</th><th>الفترة</th><th /></tr></thead>
          <tbody>{pending.map((l) => (
            <tr key={l.id}><LeaveCells l={l} canView={ov.can_manage} />
              <td>{ov.can_manage && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="btn btn-action btn-xs" type="button" onClick={() => { setDecide({ l, approve: true }); setDPaid(l.is_paid); setNote(""); }}>موافقة</button>
                <button className="btn btn-quiet btn-xs" type="button" onClick={() => { setDecide({ l, approve: false }); setNote(""); }}>رفض</button></div>}</td>
            </tr>))}</tbody>
        </table>
      )}

      <h2 style={{ marginTop: 20 }}>المباشرة بعد الإجازة</h2>
      <p className="small muted">بعد نهاية الإجازة يسجّل الموظف مباشرته من رابطه، فتؤكدها هنا. أيام العمل بين نهاية الإجازة والمباشرة تظهر اقتراح خصم في «الخصومات».</p>
      {returns.length === 0 ? <p className="muted small">لا أحد بانتظار المباشرة.</p> : (
        <table className="deadlines labor-table">
          <thead><tr><th>الموظف</th><th>الإجازة</th><th>الفترة</th><th>المباشرة</th></tr></thead>
          <tbody>{returns.map((l) => <ReturnRow key={l.id} l={l} ov={ov} act={act} />)}</tbody>
        </table>
      )}

      {current.length > 0 && <>
        <h2 style={{ marginTop: 20 }}>في إجازة الآن</h2>
        <table className="deadlines labor-table"><thead><tr><th>الموظف</th><th>النوع</th><th>الفترة</th><th /></tr></thead>
          <tbody>{current.map((l) => <tr key={l.id}><LeaveCells l={l} canView={ov.can_manage} /><td>{ov.can_manage && !l.return_date &&
            <button className="link-btn" type="button" onClick={() => act(() => api.hrCancelLeave(l.id), `أُلغيت إجازة ${l.full_name}`)}>إلغاء</button>}</td></tr>)}</tbody></table>
      </>}

      <h2 style={{ marginTop: 20 }}>السجل</h2>
      <table className="deadlines labor-table">
        <thead><tr><th>الموظف</th><th>النوع</th><th>الفترة</th><th>الحالة</th></tr></thead>
        <tbody>{history.map((l) => (
          <tr key={l.id}><LeaveCells l={l} canView={ov.can_manage} /><td><span className="status-chip" data-s={CHIP[l.status]}>{LEAVE_STATUS[l.status]}</span>
            {l.decision_note && <div className="small muted">{l.decision_note}</div>}
            {l.return_confirmed_at && l.return_date && <div className="small muted">باشر {formatDate(l.return_date)}</div>}</td></tr>))}
          {history.length === 0 && <tr><td colSpan={4} className="muted">لا سجل بعد.</td></tr>}</tbody>
      </table>

      {decide && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && setDecide(null)}>
          <form className="modal" onSubmit={async (e) => { e.preventDefault();
            if (await act(() => api.hrDecideLeave(decide.l.id, { approve: decide.approve, note: note || null,
              is_paid: decide.approve && canChoose(decide.l) ? dPaid : null }), decide.approve ? `اعتُمدت إجازة ${decide.l.full_name}` : `رُفض طلب ${decide.l.full_name}`)) setDecide(null); }}>
            <h2>{decide.approve ? "اعتماد" : "رفض"} إجازة {decide.l.full_name}</h2>
            <p className="small">{decide.l.label} · {decide.l.days} يوم · {formatDate(decide.l.start_date)} ← {formatDate(decide.l.end_date)}
              {" · "}طلبها {decide.l.is_paid ? "مدفوعة" : "بدون أجر"}</p>
            {decide.approve && canChoose(decide.l) && (
              <fieldset className="field"><legend>اعتمادها</legend>
                <label className="checks-inline"><input type="radio" name="dp" checked={dPaid} onChange={() => setDPaid(true)} /> مدفوعة
                  {ov.policies.find((p) => p.leave_type === decide.l.leave_type)?.from_balance ? ` (رصيده ${fmtDays(ov.people.find((x) => x.id === decide.l.employee_id)?.balance ?? 0)} يوم)` : ""}</label>
                <label className="checks-inline"><input type="radio" name="dp" checked={!dPaid} onChange={() => setDPaid(false)} /> بدون أجر</label>
              </fieldset>)}
            <div className="field"><label htmlFor="dn">ملاحظة للموظف {decide.approve ? "(اختياري)" : ""}</label>
              <textarea id="dn" rows={2} maxLength={500} required={!decide.approve} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <p className="small muted">يصل الموظف إشعار واتساب بالقرار إن كان جواله مسجلاً.</p>
            <div className="modal-actions"><button className={decide.approve ? "btn btn-action" : "btn"} type="submit">{decide.approve ? "اعتماد" : "رفض"}</button>
              <button className="btn btn-quiet" type="button" onClick={() => setDecide(null)}>إلغاء</button></div>
          </form>
        </div>
      )}
    </section>
  );
}

function ReturnRow({ l, ov, act }: { l: LeaveRow; ov: HrOverview; act: Act }) {
  const [d, setD] = useState(l.return_date ?? today());
  return (
    <tr>
      <td><b>{l.full_name}</b></td>
      <td>{l.label}</td>
      <td className="small">انتهت {formatDate(l.end_date)}</td>
      <td>
        {l.return_submitted_at ? <div className="small">أبلغ بالمباشرة: <b>{formatDate(l.return_date!)}</b></div> : <div className="small muted">لم يسجّل مباشرته بعد</div>}
        {l.late_return_days > 0 && <div className="small" style={{ color: "var(--danger, #b91c1c)" }}>تأخر {l.late_return_days} يوم عمل</div>}
        {ov.can_manage && <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
          <input type="date" aria-label="تاريخ المباشرة" value={d} min={l.start_date} onChange={(e) => setD(e.target.value)} style={{ maxWidth: 160 }} />
          <button className="btn btn-action btn-xs" type="button" onClick={() => act(() => api.hrConfirmReturn(l.id, d), `أُكدت مباشرة ${l.full_name}`)}>تأكيد المباشرة</button>
        </div>}
      </td>
    </tr>
  );
}

function AddLeave({ ov, act, onDone }: { ov: HrOverview; act: Act; onDone: () => void }) {
  const [v, setV] = useState({ employee_id: ov.people[0]?.id ?? "", leave_type: "ANNUAL" as LeaveType, start_date: today(), end_date: today(), reason: "", medical_ref: "", approve: true });
  const [att, setAtt] = useState<LeaveAttachment | null>(null);
  const [paid, setPaid] = useState(true);
  const pol = ov.policies.find((p) => p.leave_type === v.leave_type);
  return (
    <form className="panel inline-form" style={{ marginTop: 8 }} onSubmit={async (e) => { e.preventDefault();
      if (await act(() => api.hrAddLeave({ ...v, reason: v.reason || null, medical_ref: v.medical_ref || null, attachment: v.leave_type === "SICK" ? att : null,
        is_paid: pol?.pay_mode === "CHOICE" ? paid : null }), "أُضيفت الإجازة")) onDone(); }}>
      <h2>إدخال إجازة</h2>
      <div className="grid">
        <div className="field"><label htmlFor="le">الموظف</label><select id="le" value={v.employee_id} onChange={(e) => setV({ ...v, employee_id: e.target.value })}>
          {ov.people.map((p) => <option key={p.id} value={p.id}>{p.full_name} — رصيد {fmtDays(p.balance)}</option>)}</select></div>
        <div className="field"><label htmlFor="lt">النوع</label><select id="lt" value={v.leave_type} onChange={(e) => setV({ ...v, leave_type: e.target.value as LeaveType })}>
          {ov.policies.filter((p) => p.is_active).map((p) => <option key={p.leave_type} value={p.leave_type}>{p.label}</option>)}</select></div>
        <div className="field"><label htmlFor="ls">من</label><input id="ls" type="date" required value={v.start_date} onChange={(e) => setV({ ...v, start_date: e.target.value, end_date: e.target.value > v.end_date ? e.target.value : v.end_date })} /></div>
        <div className="field"><label htmlFor="ld">إلى</label><input id="ld" type="date" required min={v.start_date} value={v.end_date} onChange={(e) => setV({ ...v, end_date: e.target.value })} /></div>
        {v.leave_type === "SICK" && <>
          <div className="field"><label htmlFor="lm">رقم التقرير (اختياري)</label><input id="lm" maxLength={60} value={v.medical_ref} onChange={(e) => setV({ ...v, medical_ref: e.target.value })} /></div>
          <div className="field-wide"><AttachPicker value={att} onChange={setAtt} /></div>
        </>}
        {pol?.pay_mode === "CHOICE" && <div className="field"><label htmlFor="lp">الأجر</label>
          <select id="lp" value={paid ? "1" : "0"} onChange={(e) => setPaid(e.target.value === "1")}><option value="1">مدفوعة{pol.from_balance ? " (من الرصيد)" : ""}</option><option value="0">بدون أجر</option></select></div>}
        <div className="field field-wide"><label htmlFor="lr">ملاحظة</label><input id="lr" maxLength={500} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></div>
      </div>
      <label className="checks-inline"><input type="checkbox" checked={v.approve} onChange={(e) => setV({ ...v, approve: e.target.checked })} /> معتمدة مباشرة</label>
      <div style={{ display: "flex", gap: 8 }}><button className="btn btn-action" type="submit">حفظ</button><button className="btn btn-quiet" type="button" onClick={onDone}>إلغاء</button></div>
    </form>
  );
}

function BalancesTab({ ov, act }: { ov: HrOverview; act: Act }) {
  const [adj, setAdj] = useState<{ id: string; name: string } | null>(null);
  const [days, setDays] = useState("");
  const [note, setNote] = useState("");
  const year = ov.people[0]?.year;
  return (
    <section className="gov-section" style={{ marginTop: 8 }}>
      <p className="small muted">رصيد الإجازة السنوية لعام {year}: 21 يوماً، و30 يوماً لمن أتم خمس سنوات (المادة 109)، ناقص المستخدم من الأنواع التي تُخصم من الرصيد.
        أضف الرصيد المرحّل من السنوات السابقة أو أي تصحيح بـ«تعديل».</p>
      <table className="deadlines labor-table">
        <thead><tr><th>الموظف</th><th>الاستحقاق</th><th>تعديلات</th><th>المستخدم</th><th>المتبقي</th><th /></tr></thead>
        <tbody>{ov.people.map((p) => (
          <tr key={p.id}><td><b>{p.full_name}</b>{p.job_title && <div className="small muted">{p.job_title}</div>}</td>
            <td>{p.entitlement}</td><td>{p.adjustments ? fmtDays(p.adjustments) : "—"}</td><td>{p.used}</td>
            <td><b>{fmtDays(p.balance)}</b></td>
            <td>{ov.can_manage && <button className="link-btn" type="button" onClick={() => { setAdj({ id: p.id, name: p.full_name }); setDays(""); setNote(""); }}>تعديل</button>}</td></tr>))}</tbody>
      </table>
      {adj && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && setAdj(null)}>
          <form className="modal" onSubmit={async (e) => { e.preventDefault(); if (await act(() => api.hrAdjust(adj.id, { days: Number(days), note }), `عُدّل رصيد ${adj.name}`)) setAdj(null); }}>
            <h2>تعديل رصيد {adj.name}</h2>
            <div className="field"><label htmlFor="ad">الأيام (+ للإضافة، − للخصم)</label><input id="ad" type="number" step="0.5" required value={days} onChange={(e) => setDays(e.target.value)} /></div>
            <div className="field"><label htmlFor="an">السبب</label><input id="an" required minLength={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="رصيد مرحّل من 2025" /></div>
            <div className="modal-actions"><button className="btn btn-action" type="submit">حفظ</button><button className="btn btn-quiet" type="button" onClick={() => setAdj(null)}>إلغاء</button></div>
          </form>
        </div>
      )}
    </section>
  );
}

function DeductionsTab({ ov, act }: { ov: HrOverview; act: Act }) {
  const [month, setMonth] = useState(today().slice(0, 7));
  const [d, setD] = useState<HrDeductions | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [issue, setIssue] = useState<Partial<DeductionSuggestion> & { amount?: number } | null>(null);
  const [decide, setDecide] = useState<{ id: string; name: string; confirm: boolean } | null>(null);
  const [note, setNote] = useState("");
  const load = useCallback(() => { setD(null); api.hrDeductions(month).then(setD).catch((e: Error) => setErr(e.message)); }, [month]);
  useEffect(load, [load]);
  const wrap: Act = async (fn, ok) => { const r = await act(fn, ok); if (r) load(); return r; };
  function csv() {
    if (!d) return;
    const lines = [["الموظف", "النوع", "تاريخ الواقعة", "الوصف", "المبلغ", "الحالة"], ...d.notices.filter((n) => n.status !== "CANCELLED")
      .map((n) => [n.full_name, n.kind_label, n.incident_date, n.description, n.amount.toFixed(2), NOTICE_STATUS[n.status]]),
      ...d.unpaid_leaves.map((u) => [u.full_name, `إجازة ${u.label} بدون أجر`, u.from_date, `${u.days} يوم (${u.from_date} إلى ${u.to_date})`, u.amount.toFixed(2), "معتمدة"])]
      .map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(","));
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `deductions-${month}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  return (
    <section className="gov-section" style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
        <div className="field"><label htmlFor="dm">شهر الرواتب</label><input id="dm" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></div>
        {ov.can_manage && <button className="btn" type="button" onClick={() => setIssue({ kind: "VIOLATION", incident_date: today() })}>إشعار خصم جديد</button>}
        <button className="btn btn-quiet" type="button" disabled={!d} onClick={csv}>تصدير لمسيّر الرواتب (CSV)</button>
      </div>
      <p className="hint-box small" style={{ marginTop: 8 }}>ضوابط نظام العمل يتحقق منها حصيف عند الإصدار: الغرامة عن المخالفة لا تتجاوز أجر خمسة أيام ولا مجموع الغرامات في الشهر،
        ولا يُوقَّع جزاء على مخالفة مضى على كشفها أكثر من 30 يوماً، ومجموع الحسم لا يتجاوز نصف الأجر. يُبلَّغ الموظف ويستطيع الاعتراض خلال {d?.objection_days ?? 15} يوماً قبل تأكيد الخصم.
        هذه إرشادات عامة وليست استشارة قانونية.</p>
      {err && <p className="error">{err}</p>}
      {!d ? <div className="boot" aria-busy="true" /> : <>
        <h2 style={{ marginTop: 16 }}>إشعارات الشهر</h2>
        <table className="deadlines labor-table">
          <thead><tr><th>الموظف</th><th>الواقعة</th><th>المبلغ</th><th>الحالة</th><th /></tr></thead>
          <tbody>{d.notices.map((n) => (
            <tr key={n.id}>
              <td><b>{n.full_name}</b><div className="small muted">{n.seen_at ? "اطّلع عليه" : "لم يطّلع بعد"}</div></td>
              <td>{n.kind_label}<div className="small muted">{formatDate(n.incident_date)} · {n.description}</div></td>
              <td>{sar(n.amount)}</td>
              <td><span className="status-chip" data-s={CHIP[n.status]}>{NOTICE_STATUS[n.status]}</span>
                {n.objection_text && <div className="small" style={{ marginTop: 4 }}>اعتراضه: «{n.objection_text}»</div>}
                {n.decision_note && <div className="small muted">{n.decision_note}</div>}</td>
              <td>{ov.can_manage && ["ISSUED", "OBJECTED"].includes(n.status) && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="btn btn-action btn-xs" type="button" onClick={() => { setDecide({ id: n.id, name: n.full_name, confirm: true }); setNote(""); }}>تأكيد</button>
                <button className="btn btn-quiet btn-xs" type="button" onClick={() => { setDecide({ id: n.id, name: n.full_name, confirm: false }); setNote(""); }}>إلغاء</button></div>}</td>
            </tr>))}
            {d.notices.length === 0 && <tr><td colSpan={5} className="muted">لا إشعارات لهذا الشهر.</td></tr>}</tbody>
        </table>
        {d.summary.length > 0 && <>
          <h2 style={{ marginTop: 20 }}>ملخص الشهر لكل موظف</h2>
          <table className="deadlines labor-table"><thead><tr><th>الموظف</th><th>الغرامات / السقف</th><th>مجموع الحسم / نصف الأجر</th><th>المؤكد</th></tr></thead>
            <tbody>{d.summary.map((s) => <tr key={s.employee_id}><td>{s.full_name}</td><td>{sar(s.fines)} / {sar(s.fine_cap)}</td><td>{sar(s.total)} / {sar(s.half_wage)}</td><td><b>{sar(s.confirmed)}</b></td></tr>)}</tbody></table>
        </>}
        {d.unpaid_leaves.length > 0 && <>
          <h2 style={{ marginTop: 20 }}>إجازات بدون أجر هذا الشهر</h2>
          <p className="small muted">أيام لا يُستحق عنها أجر (ليست جزاءً ولا تحتاج إشعار خصم)، وتدخل في ملف مسيّر الرواتب.</p>
          <table className="deadlines labor-table"><thead><tr><th>الموظف</th><th>الإجازة</th><th>الأيام في الشهر</th><th>المبلغ</th></tr></thead>
            <tbody>{d.unpaid_leaves.map((u) => <tr key={u.leave_id}><td>{u.full_name}</td><td>{u.label}<div className="small muted">{formatDate(u.from_date)} ← {formatDate(u.to_date)}</div></td>
              <td>{u.days}</td><td><b>{sar(u.amount)}</b></td></tr>)}</tbody></table>
        </>}
        <h2 style={{ marginTop: 20 }}>اقتراحات من سجل الحضور والمباشرة</h2>
        <p className="small muted">لا يصدر شيء تلقائياً: راجع كل اقتراح، ولك أن تكتفي بالتنبيه أو الإنذار وفق لائحة تنظيم العمل في منشأتك.</p>
        <table className="deadlines labor-table">
          <thead><tr><th>الموظف</th><th>الواقعة</th><th>المبلغ المقترح</th><th /></tr></thead>
          <tbody>{d.suggestions.map((s, i) => (
            <tr key={i}><td>{s.full_name}</td><td>{s.kind_label}<div className="small muted">{s.description}</div></td><td>{sar(s.amount)}</td>
              <td>{ov.can_manage && <button className="btn btn-xs" type="button" onClick={() => setIssue(s)}>إصدار إشعار</button>}</td></tr>))}
            {d.suggestions.length === 0 && <tr><td colSpan={4} className="muted">لا اقتراحات.</td></tr>}</tbody>
        </table>
      </>}
      {issue && <IssueModal ov={ov} s={issue} month={month} act={wrap} onClose={() => setIssue(null)} />}
      {decide && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && setDecide(null)}>
          <form className="modal" onSubmit={async (e) => { e.preventDefault();
            if (await wrap(() => api.hrDecideNotice(decide.id, { confirm: decide.confirm, note: note || null }), decide.confirm ? `أُكد خصم ${decide.name}` : `أُلغي إشعار ${decide.name}`)) setDecide(null); }}>
            <h2>{decide.confirm ? "تأكيد الخصم" : "إلغاء الإشعار"} — {decide.name}</h2>
            <div className="field"><label htmlFor="nn">ملاحظة (تصل للموظف)</label><textarea id="nn" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <div className="modal-actions"><button className="btn btn-action" type="submit">{decide.confirm ? "تأكيد" : "إلغاء الإشعار"}</button>
              <button className="btn btn-quiet" type="button" onClick={() => setDecide(null)}>رجوع</button></div>
          </form>
        </div>
      )}
    </section>
  );
}

function IssueModal({ ov, s, month, act, onClose }: { ov: HrOverview; s: Partial<DeductionSuggestion>; month: string; act: Act; onClose: () => void }) {
  const [v, setV] = useState({ employee_id: s.employee_id ?? ov.people[0]?.id ?? "", kind: (s.kind ?? "VIOLATION") as DeductionKind, incident_date: s.incident_date ?? today(),
    description: s.description ?? "", amount: s.amount != null ? String(s.amount) : "", payroll_month: (s.incident_date ?? month).slice(0, 7) });
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal modal-wide" onSubmit={async (e) => { e.preventDefault();
        if (await act(() => api.hrAddNotice({ ...v, amount: Number(v.amount), leave_request_id: s.leave_request_id ?? null }), "صدر الإشعار وأُبلغ الموظف")) onClose(); }}>
        <h2>إشعار خصم</h2>
        <div className="grid">
          <div className="field"><label htmlFor="ie">الموظف</label><select id="ie" value={v.employee_id} disabled={!!s.employee_id} onChange={(e) => setV({ ...v, employee_id: e.target.value })}>
            {ov.people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>
          <div className="field"><label htmlFor="ik">النوع</label><select id="ik" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as DeductionKind })}>
            {(Object.keys(KIND_LABEL) as DeductionKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></div>
          <div className="field"><label htmlFor="id">تاريخ الواقعة</label><input id="id" type="date" required max={today()} value={v.incident_date} onChange={(e) => setV({ ...v, incident_date: e.target.value })} /></div>
          <div className="field"><label htmlFor="im">يُخصم في رواتب شهر</label><input id="im" type="month" required value={v.payroll_month} onChange={(e) => setV({ ...v, payroll_month: e.target.value })} /></div>
          <div className="field"><label htmlFor="ia">المبلغ (ريال)</label><input id="ia" type="number" step="0.01" min={0.01} required value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></div>
          <div className="field field-wide"><label htmlFor="ix">وصف الواقعة</label><textarea id="ix" rows={2} required minLength={3} maxLength={1000} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></div>
        </div>
        <p className="small muted">يصل الموظف إشعار بالخصم وسببه، ويستطيع الاعتراض من رابطه الشخصي قبل أن تؤكده.</p>
        <div className="modal-actions"><button className="btn btn-action" type="submit">إصدار</button><button className="btn btn-quiet" type="button" onClick={onClose}>إلغاء</button></div>
      </form>
    </div>
  );
}

function SettingsTab({ ov, act }: { ov: HrOverview; act: Act }) {
  const [s, setS] = useState(ov.settings);
  const dis = !ov.can_manage;
  return (
    <section className="gov-section" style={{ marginTop: 8 }}>
      <h2>أنواع الإجازات</h2>
      <p className="small muted">الأنواع الأربعة متاحة للموظف. حدّد لكل نوع: هل هو مدفوع، وهل يُخصم من رصيد الإجازة السنوية، وحدوده.</p>
      <div className="pay-grid">{LEAVE_TYPES.map((t) => <PolicyCard key={t} p={ov.policies.find((x) => x.leave_type === t)!} dis={dis} act={act} />)}</div>
      <h2 style={{ marginTop: 20 }}>الإعدادات العامة</h2>
      <form className="panel inline-form" onSubmit={(e) => { e.preventDefault(); act(() => api.hrSettings(s), "حُفظت الإعدادات"); }}>
        <label className="checks-inline"><input type="checkbox" disabled={dis} checked={s.count_workdays_only} onChange={(e) => setS({ ...s, count_workdays_only: e.target.checked })} />
          تُحسب أيام الإجازة على أيام العمل فقط (دون العطلة الأسبوعية والعطل الرسمية). الإجازة المرضية تُحسب بالأيام التقويمية دائماً.</label>
        <label className="checks-inline"><input type="checkbox" disabled={dis} checked={s.notify_employees} onChange={(e) => setS({ ...s, notify_employees: e.target.checked })} />
          إشعار الموظف على واتساب بقرارات الإجازة والخصم (يلزم جواله في سجله أو ربطه ببوت الموظفين)</label>
        <div className="field" style={{ maxWidth: 260 }}><label htmlFor="od">مهلة اعتراض الموظف على الخصم (يوم)</label>
          <input id="od" type="number" min={1} max={60} disabled={dis} value={s.objection_days} onChange={(e) => setS({ ...s, objection_days: Number(e.target.value) })} /></div>
        {!dis && <div><button className="btn btn-action" type="submit">حفظ</button></div>}
      </form>
      <p className="small muted" style={{ marginTop: 12 }}>أيام العمل وساعات الدوام تُضبط من <Link href="/attendance">الحضور بالموقع</Link>، والعطل الرسمية من <Link href="/events">تقويم المناسبات</Link>.</p>
    </section>
  );
}

function PolicyCard({ p, dis, act }: { p: HrOverview["policies"][number]; dis: boolean; act: Act }) {
  const [v, setV] = useState(p);
  const num = (x: string) => (x === "" ? null : Number(x));
  return (
    <form className="panel pay-card" onSubmit={(e) => { e.preventDefault(); act(() => api.hrPolicy(p.leave_type, { pay_mode: v.pay_mode, from_balance: v.from_balance,
      max_days_per_request: v.max_days_per_request, yearly_cap: v.yearly_cap, min_notice_days: v.min_notice_days, is_active: v.is_active }), `حُفظت الإجازة ال${LEAVE_LABEL[p.leave_type]}`); }}>
      <h3>الإجازة ال{LEAVE_LABEL[p.leave_type]}</h3>
      <label className="checks-inline"><input type="checkbox" disabled={dis} checked={v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} /> متاحة للموظفين</label>
      <div className="field"><label>الأجر</label>
        <select disabled={dis || p.leave_type === "ANNUAL" || p.leave_type === "SICK"} value={v.pay_mode} onChange={(e) => setV({ ...v, pay_mode: e.target.value as PayMode })}>
          {(Object.keys(PAY_MODE_LABEL) as PayMode[]).map((k) => <option key={k} value={k}>{PAY_MODE_LABEL[k]}</option>)}</select></div>
      {v.pay_mode !== "UNPAID" && p.leave_type !== "SICK" && <label className="checks-inline"><input type="checkbox" disabled={dis || p.leave_type === "ANNUAL"} checked={v.from_balance}
        onChange={(e) => setV({ ...v, from_balance: e.target.checked })} /> المدفوعة تُخصم من الرصيد السنوي</label>}
      {v.pay_mode === "CHOICE" && <p className="small muted">يختار الموظف عند الطلب، ولك تعديل اختياره عند الاعتماد. بدون أجر لا تمس الرصيد ويُحسم أجر أيامها من راتب الشهر.</p>}
      <div className="field"><label>أقصى مدة للطلب الواحد</label><input type="number" min={1} max={120} placeholder="بلا حد" disabled={dis} value={v.max_days_per_request ?? ""} onChange={(e) => setV({ ...v, max_days_per_request: num(e.target.value) })} /></div>
      <div className="field"><label>الحد السنوي (يوم)</label><input type="number" min={1} max={365} placeholder="بلا حد" disabled={dis} value={v.yearly_cap ?? ""} onChange={(e) => setV({ ...v, yearly_cap: num(e.target.value) })} /></div>
      {p.leave_type !== "EMERGENCY" && p.leave_type !== "SICK" && <div className="field"><label>إشعار مسبق (يوم)</label><input type="number" min={0} max={90} disabled={dis} value={v.min_notice_days} onChange={(e) => setV({ ...v, min_notice_days: Number(e.target.value) || 0 })} /></div>}
      {p.leave_type === "SICK" && <p className="small muted">المادة 117: 30 يوماً بأجر كامل، ثم 60 بثلاثة أرباع الأجر، ثم 30 دون أجر خلال السنة. يُطلب إرفاق التقرير الطبي من الموظف.</p>}
      {p.leave_type === "EMERGENCY" && <p className="small muted">تُقبل حتى 3 أيام بعد بدايتها.</p>}
      {!dis && <button className="btn btn-xs" type="submit">حفظ</button>}
    </form>
  );
}
