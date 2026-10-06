"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  NITAQAT_BAND, TASK_WHERE, countDays, formatDate, parseEmployeesCsv, sar,
  type Employee, type EmployeeInput, type GosiCalcResult, type GosiMonth, type GosiRate, type LaborOverview, type LaborProfile, type LaborTask,
} from "@haseef/shared";
import { api } from "@/lib/session";

type Tab = "calendar" | "employees" | "gosi" | "qiwa";
type Act = (fn: () => Promise<unknown>, ok: string) => Promise<boolean>;

const monthName = (period: string) =>
  new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}T00:00:00Z`));
const SYSTEM_LABEL: Record<string, string> = { OLD: "النظام السابق", NEW: "النظام الجديد", NON_SAUDI: "غير السعوديين" };
const NAT_LABEL: Record<string, string> = { SAUDI: "سعودي", NON_SAUDI: "غير سعودي" };
const UPSELL = "سجل الموظفين وحاسبة التأمينات ومؤشرات قوى غير مفعّلة لمنشأتك. تواصل مع فريق حصيف لتفعيلها.";

function taskState(t: LaborTask): { s: string; label: string } {
  if (t.done_at) return { s: "IN_PLACE", label: "تم" };
  if (t.overdue) return { s: "FAIL", label: `متأخر ${countDays(-t.days_left)}` };
  if (t.days_left === 0) return { s: "PENDING", label: "اليوم" };
  return { s: t.days_left <= 5 ? "PENDING" : "", label: `بعد ${countDays(t.days_left)}` };
}

export default function LaborPage() {
  const [tab, setTab] = useState<Tab>("calendar");
  const [ov, setOv] = useState<LaborOverview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => { api.laborOverview().then(setOv).catch((e: Error) => setError(e.message)); setTick((n) => n + 1); }, []);
  useEffect(load, [load]);

  const act: Act = async (fn, ok) => {
    setError(null); setNotice(null);
    try { await fn(); setNotice(ok); load(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "تعذّر التنفيذ"); return false; }
  };

  if (!ov) return error ? <p className="error" role="alert">{error}</p> : <div className="boot" aria-busy="true" />;
  const overdue = ov.tasks.filter((t) => t.overdue);
  const ind = ov.indicators;

  return (
    <>
      <header className="page-head">
        <h1>العمل والموظفين</h1>
        <p className="muted">تقويم شهري لسداد التأمينات الاجتماعية ورفع ملف حماية الأجور في مُدد وصرف الرواتب، مع تنبيهات قبل كل موعد،
          وسجل للموظفين يتابع الإقامات ورخص العمل والعقود وتوثيقها في قوى.</p>
      </header>

      {!ov.enabled ? (
        <SetupPanel canManage={ov.can_manage} act={act} />
      ) : (
        <>
          <dl className="obl-stats labor-stats">
            <div><dt>التزامات متأخرة</dt><dd data-s={overdue.length ? "LATE" : "IN_PLACE"}>{overdue.length}</dd></div>
            <div><dt>القادم خلال 7 أيام</dt><dd data-s="PENDING">{ov.tasks.filter((t) => !t.done_at && t.days_left >= 0 && t.days_left <= 7).length}</dd></div>
            {ov.gosi_month && <div><dt>تأمينات {monthName(ov.gosi_month.period)}</dt><dd className="num-dd">{sar(ov.gosi_month.total)}</dd></div>}
            {ind && <div><dt>الموظفون · السعودة</dt><dd>{ind.employees} <small className="muted">· {ind.saudization_pct}%</small></dd></div>}
            {ind && <div><dt>عقود موثقة في قوى</dt><dd data-s={ind.documented_pct === 100 ? "IN_PLACE" : "PENDING"}>{ind.documented_pct}%</dd></div>}
          </dl>

          <div className="tabs-row">
            <div className="filters" role="tablist">
              {([["calendar", "التقويم الشهري"], ["employees", "الموظفون"], ["gosi", "التأمينات الاجتماعية"], ["qiwa", "قوى ونطاقات"]] as [Tab, string][]).map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>
              ))}
            </div>
            <Link className="btn btn-quiet tabs-row-link" href="/alerts">ضبط التنبيهات ←</Link>
          </div>
          {notice && <p className="notice" role="status">{notice}</p>}
          {error && <p className="error" role="alert">{error}</p>}

          {tab === "calendar" && <CalendarTab ov={ov} act={act} />}
          {tab === "employees" && (ov.hr ? <EmployeesTab key={tick} canManage={ov.can_manage} act={act} /> : <p className="hint-box">{UPSELL}</p>)}
          {tab === "gosi" && (ov.hr ? <GosiTab key={tick} canSeeWages={ov.can_manage} /> : <p className="hint-box">{UPSELL}</p>)}
          {tab === "qiwa" && <QiwaTab ov={ov} act={act} />}
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------ التفعيل
function SetupPanel({ canManage, act }: { canManage: boolean; act: Act }) {
  const [day, setDay] = useState(27);
  if (!canManage) return <p className="hint-box">يفعّل مدير المنشأة أو مسؤول الامتثال تقويم العمل من هذه الصفحة.</p>;
  return (
    <form className="panel inline-form" onSubmit={(e) => { e.preventDefault(); act(() => api.setLaborProfile({ salary_day: day, nitaqat_band: null, nitaqat_checked_on: null, gosi_employer_no: null }), "فُعّل تقويم العمل والتنبيهات"); }}>
      <h2>فعّل تقويم العمل</h2>
      <p className="muted">ينشئ حصيف كل شهر ثلاث مهام بمواعيدها النظامية، وينبّه المستلمين قبل 5 أيام ويوم واحد ويوم الاستحقاق:</p>
      <ul className="labor-rules">
        <li><b>صرف الرواتب</b> في اليوم الذي تحدده.</li>
        <li><b>سداد اشتراكات التأمينات الاجتماعية</b> حتى اليوم 15 من الشهر التالي، وبعده غرامة تأخير 2% عن كل شهر.</li>
        <li><b>رفع ملف حماية الأجور في مُدد</b> خلال 30 يوماً من نهاية الشهر، وعدم الرفع غرامته من 500 إلى 2,000 ريال حسب حجم المنشأة.</li>
      </ul>
      <div className="grid">
        <div className="field"><label htmlFor="sd">يوم صرف الرواتب</label>
          <input id="sd" type="number" min={1} max={28} required value={day} onChange={(e) => setDay(Number(e.target.value))} /></div>
      </div>
      <div><button className="btn btn-action" type="submit">تفعيل</button></div>
    </form>
  );
}

// ------------------------------------------------------------------ التقويم الشهري
function CalendarTab({ ov, act }: { ov: LaborOverview; act: Act }) {
  const [doing, setDoing] = useState<LaborTask | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, LaborTask[]>();
    for (const t of ov.tasks) m.set(t.period, [...(m.get(t.period) ?? []), t]);
    return [...m.entries()];
  }, [ov.tasks]);

  return (
    <section className="gov-section" style={{ marginTop: 8 }}>
      {groups.map(([period, tasks]) => (
        <div key={period} className="labor-month">
          <h2>{monthName(period)}</h2>
          <table className="deadlines labor-table">
            <thead><tr><th>الالتزام</th><th>الموعد</th><th>الحالة</th><th>المبلغ</th><th /></tr></thead>
            <tbody>
              {tasks.map((t) => {
                const st = taskState(t);
                return (
                  <tr key={t.id}>
                    <td><b>{t.label}</b>
                      <div className="small muted">في <a href={TASK_WHERE[t.kind].url} target="_blank" rel="noreferrer">{TASK_WHERE[t.kind].name}</a>
                        {t.done_at && <> · أكّده {t.done_by_name ?? "—"}{t.reference && <> · مرجع <bdi dir="ltr">{t.reference}</bdi></>}</>}</div>
                      {t.penalty_estimate ? <div className="small late">غرامة تأخير متوقعة حتى اليوم: {sar(t.penalty_estimate)}</div> : null}
                    </td>
                    <td>{formatDate(t.due_date)}</td>
                    <td><span className="status-chip" data-s={st.s || undefined}>{st.label}</span></td>
                    <td className="num">{t.amount ? sar(t.amount) : "—"}</td>
                    <td>{ov.can_manage && (t.done_at
                      ? <button className="btn btn-quiet btn-xs" type="button" onClick={() => act(() => api.laborTaskReopen(t.id), "أُعيد فتح المهمة")}>تراجع</button>
                      : <button className="btn btn-action btn-xs" type="button" onClick={() => setDoing(t)}>تم الإنجاز</button>)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      {doing && <DoneDialog task={doing} onClose={() => setDoing(null)}
        onSave={async (reference, amount) => { if (await act(() => api.laborTaskDone(doing.id, { reference, amount }), `سُجّل: ${doing.label}`)) setDoing(null); }} />}

      {ov.documents && ov.documents.length > 0 && (
        <div className="labor-month">
          <h2>وثائق الموظفين خلال 90 يوماً</h2>
          <table className="deadlines labor-table">
            <thead><tr><th>الموظف</th><th>الوثيقة</th><th>التاريخ</th><th>المتبقي</th></tr></thead>
            <tbody>
              {ov.documents.map((d) => (
                <tr key={d.employee_id + d.kind}>
                  <td>{d.full_name}</td><td>{d.label}</td><td>{formatDate(d.due_date)}</td>
                  <td><span className="status-chip" data-s={d.days_left < 0 ? "FAIL" : d.days_left <= 30 ? "PENDING" : undefined}>
                    {d.days_left < 0 ? `منتهية منذ ${countDays(-d.days_left)}` : d.days_left === 0 ? "اليوم" : `بعد ${countDays(d.days_left)}`}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">حصيف لا يدخل حساباتك في التأمينات أو قوى أو مُدد: أنجز الالتزام هناك ثم أكّده هنا برقم السداد أو المرجع.</p>
    </section>
  );
}

function DoneDialog({ task, onClose, onSave }: { task: LaborTask; onClose: () => void; onSave: (ref: string | null, amount: number | null) => void }) {
  const [ref, setRef] = useState("");
  const [amount, setAmount] = useState(task.amount ? String(task.amount) : "");
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={task.label} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal" onSubmit={(e) => { e.preventDefault(); onSave(ref.trim() || null, amount ? Number(amount) : null); }}>
        <h2>{task.label} — {monthName(task.period)}</h2>
        <div className="field"><label htmlFor="ref">{task.kind === "GOSI_PAYMENT" ? "رقم فاتورة سداد" : "المرجع (اختياري)"}</label>
          <input id="ref" dir="ltr" maxLength={100} value={ref} onChange={(e) => setRef(e.target.value)} /></div>
        {task.kind === "GOSI_PAYMENT" && <div className="field"><label htmlFor="amt">المبلغ المسدد</label>
          <input id="amt" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>}
        <div className="modal-actions">
          <button className="btn btn-action" type="submit">تأكيد الإنجاز</button>
          <button className="btn btn-quiet" type="button" onClick={onClose}>إلغاء</button>
        </div>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ الموظفون
const EMPTY_EMP: EmployeeInput = {
  full_name: "", nationality: "SAUDI", job_title: null, start_date: new Date().toISOString().slice(0, 10), gosi_system: "NEW",
  basic_wage: 0, housing_allowance: 0, gosi_registered: true, qiwa_contract_documented: false,
  contract_end_date: null, probation_end_date: null, iqama_expiry: null, work_permit_expiry: null,
};
const CSV_TEMPLATE = "الاسم,الجنسية,المسمى الوظيفي,تاريخ المباشرة,الراتب الأساسي,بدل السكن,انتهاء الإقامة,انتهاء رخصة العمل,انتهاء العقد,موثق في قوى,مسجل في التأمينات,النظام الجديد\n"
  + "سارة الحربي,سعودي,محاسبة,2025-09-01,9000,2250,,,2027-08-31,نعم,نعم,نعم\nرفيق أحمد,غير سعودي,فني,2023-03-15,3000,750,2027-03-14,2027-03-14,,نعم,نعم,لا\n";

function EmployeesTab({ canManage, act }: { canManage: boolean; act: Act }) {
  const [data, setData] = useState<{ employees: Employee[]; show_wages: boolean } | null>(null);
  const [edit, setEdit] = useState<{ id: string | null; v: EmployeeInput } | null>(null);
  const [importing, setImporting] = useState(false);
  const [showLeft, setShowLeft] = useState(false);
  const [leaving, setLeaving] = useState<Employee | null>(null);
  const [leftOn, setLeftOn] = useState(new Date().toISOString().slice(0, 10));
  useEffect(() => { api.employees().then(setData).catch(() => setData({ employees: [], show_wages: false })); }, []);
  if (!data) return <div className="boot" aria-busy="true" />;
  const rows = data.employees.filter((e) => showLeft || e.is_active);
  const left = data.employees.filter((e) => !e.is_active).length;

  return (
    <section className="gov-section" style={{ marginTop: 8 }}>
      <div className="head-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h2>الموظفون ({data.employees.filter((e) => e.is_active).length})</h2>
        {canManage && <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-quiet" type="button" onClick={() => setImporting((x) => !x)}>استيراد من Excel / CSV</button>
          <button className="btn btn-action" type="button" onClick={() => setEdit({ id: null, v: { ...EMPTY_EMP } })}>+ موظف</button>
        </div>}
      </div>
      {!data.show_wages && <p className="small muted">الأجور مخفية: يطّلع عليها مدير المنشأة ومسؤول الامتثال فقط.</p>}
      {importing && <ImportPanel onDone={async (rows) => { if (await act(() => api.importEmployees(rows), `استُورد ${rows.length} موظفاً`)) setImporting(false); }} />}
      {edit && <EmployeeForm init={edit.v} onCancel={() => setEdit(null)}
        onSave={async (v) => { if (await act(() => edit.id ? api.updateEmployee(edit.id, v) : api.createEmployee(v), `حُفظ: ${v.full_name}`)) setEdit(null); }} />}
      {rows.length === 0 ? <p className="empty">لا موظفين بعد. أضفهم يدوياً أو استوردهم من ملف.</p> : (
        <div className="table-scroll">
          <table className="deadlines labor-table emp-table">
            <thead><tr><th>الاسم</th><th>الجنسية</th>{data.show_wages && <th className="num">الأجر الخاضع</th>}<th>التأمينات</th><th>قوى</th><th>الإقامة / العقد</th><th /></tr></thead>
            <tbody>
              {rows.map((e) => {
                const doc = e.iqama_expiry ?? e.contract_end_date;
                const dl = doc ? Math.round((new Date(`${doc}T00:00:00Z`).getTime() - Date.now()) / 86_400_000) : null;
                return (
                  <tr key={e.id} data-left={!e.is_active || undefined}>
                    <td><b>{e.full_name}</b><div className="small muted">{e.job_title ?? "—"} · منذ {formatDate(e.start_date)}{!e.is_active && ` · انتهت خدمته ${formatDate(e.left_on!)}`}</div></td>
                    <td>{NAT_LABEL[e.nationality]}{e.nationality === "SAUDI" && <div className="small muted">{SYSTEM_LABEL[e.gosi_system]}</div>}</td>
                    {data.show_wages && <td className="num">{sar((e.basic_wage ?? 0) + (e.housing_allowance ?? 0))}</td>}
                    <td><span className="status-chip" data-s={e.gosi_registered ? "IN_PLACE" : "FAIL"}>{e.gosi_registered ? "مسجّل" : "غير مسجّل"}</span></td>
                    <td><span className="status-chip" data-s={e.qiwa_contract_documented ? "IN_PLACE" : "PENDING"}>{e.qiwa_contract_documented ? "موثّق" : "غير موثّق"}</span></td>
                    <td>{doc ? <>{formatDate(doc)}<div className={`small ${dl! < 30 ? "late" : "muted"}`}>{e.iqama_expiry ? "الإقامة" : "العقد"}{dl! < 0 ? " منتهية" : ` بعد ${countDays(dl!)}`}</div></> : "—"}</td>
                    <td>{canManage && e.is_active && <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn btn-quiet btn-xs" type="button" onClick={() => setEdit({ id: e.id, v: { ...e, basic_wage: e.basic_wage ?? 0, housing_allowance: e.housing_allowance ?? 0 } })}>تعديل</button>
                      <button className="btn btn-quiet btn-xs" type="button" onClick={() => setLeaving(e)}>إنهاء خدمة</button></div>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {leaving && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="إنهاء خدمة" onClick={(ev) => { if (ev.target === ev.currentTarget) setLeaving(null); }}>
          <form className="modal" onSubmit={async (ev) => { ev.preventDefault();
            if (await act(() => api.employeeLeave(leaving.id, leftOn), `سُجّل انتهاء خدمة ${leaving.full_name}`)) setLeaving(null); }}>
            <h2>إنهاء خدمة {leaving.full_name}</h2>
            <p className="small muted">يبقى في السجل للرجوع، ويخرج من حساب التأمينات والتنبيهات. لا تنس استبعاده من التأمينات الاجتماعية وإنهاء عقده في قوى.</p>
            <div className="field"><label htmlFor="lo">آخر يوم عمل</label><input id="lo" type="date" required value={leftOn} onChange={(ev) => setLeftOn(ev.target.value)} /></div>
            <div className="modal-actions"><button className="btn btn-action" type="submit">تأكيد</button>
              <button className="btn btn-quiet" type="button" onClick={() => setLeaving(null)}>إلغاء</button></div>
          </form>
        </div>
      )}
      {left > 0 && <label className="small muted" style={{ display: "inline-flex", gap: 6, marginTop: 8 }}>
        <input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} /> إظهار من انتهت خدمتهم ({left})</label>}
    </section>
  );
}

function EmployeeForm({ init, onSave, onCancel }: { init: EmployeeInput; onSave: (v: EmployeeInput) => void; onCancel: () => void }) {
  const [v, setV] = useState<EmployeeInput>(init);
  const set = <K extends keyof EmployeeInput>(k: K, val: EmployeeInput[K]) => setV({ ...v, [k]: val });
  const date = (k: "start_date" | "contract_end_date" | "probation_end_date" | "iqama_expiry" | "work_permit_expiry", label: string, req = false) => (
    <div className="field"><label>{label}</label><input type="date" required={req} value={v[k] ?? ""} onChange={(e) => set(k, e.target.value || (req ? v[k] : null) as never)} /></div>
  );
  return (
    <form className="panel inline-form" onSubmit={(e) => { e.preventDefault(); onSave(v); }}>
      <div className="grid">
        <div className="field"><label>الاسم</label><input required minLength={2} value={v.full_name} onChange={(e) => set("full_name", e.target.value)} /></div>
        <div className="field"><label>الجنسية</label>
          <select value={v.nationality} onChange={(e) => set("nationality", e.target.value as EmployeeInput["nationality"])}>
            <option value="SAUDI">سعودي</option><option value="NON_SAUDI">غير سعودي</option></select></div>
        <div className="field"><label>المسمى الوظيفي</label><input value={v.job_title ?? ""} onChange={(e) => set("job_title", e.target.value || null)} /></div>
        {date("start_date", "تاريخ المباشرة", true)}
        <div className="field"><label>الراتب الأساسي</label><input type="number" min={0} step="0.01" required value={v.basic_wage} onChange={(e) => set("basic_wage", Number(e.target.value))} /></div>
        <div className="field"><label>بدل السكن</label><input type="number" min={0} step="0.01" value={v.housing_allowance} onChange={(e) => set("housing_allowance", Number(e.target.value))} /></div>
        {v.nationality === "SAUDI" && <div className="field"><label>نظام التأمينات</label>
          <select value={v.gosi_system} onChange={(e) => set("gosi_system", e.target.value as EmployeeInput["gosi_system"])}>
            <option value="NEW">الجديد (أول تسجيل بعد 3 يوليو 2024)</option><option value="OLD">السابق</option></select></div>}
        {date("contract_end_date", "انتهاء العقد (المحدد المدة)")}
        {date("probation_end_date", "انتهاء فترة التجربة")}
        {v.nationality === "NON_SAUDI" && date("iqama_expiry", "انتهاء الإقامة")}
        {v.nationality === "NON_SAUDI" && date("work_permit_expiry", "انتهاء رخصة العمل")}
      </div>
      <div className="checks-inline">
        <label><input type="checkbox" checked={v.gosi_registered} onChange={(e) => set("gosi_registered", e.target.checked)} /> مسجّل في التأمينات الاجتماعية</label>
        <label><input type="checkbox" checked={v.qiwa_contract_documented} onChange={(e) => set("qiwa_contract_documented", e.target.checked)} /> العقد موثّق في قوى</label>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-action" type="submit">حفظ</button>
        <button className="btn btn-quiet" type="button" onClick={onCancel}>إلغاء</button>
      </div>
    </form>
  );
}

function ImportPanel({ onDone }: { onDone: (rows: EmployeeInput[]) => void }) {
  const [text, setText] = useState("");
  const parsed = useMemo(() => (text.trim() ? parseEmployeesCsv(text) : null), [text]);
  return (
    <div className="panel inline-form">
      <p className="muted small">احفظ ملف Excel بصيغة CSV (UTF-8) ثم ارفعه، أو الصق الصفوف. الأعمدة المعروفة: الاسم، الجنسية، المسمى الوظيفي، تاريخ المباشرة،
        الراتب الأساسي، بدل السكن، انتهاء الإقامة، انتهاء رخصة العمل، انتهاء العقد، موثق في قوى، مسجل في التأمينات، النظام الجديد.{" "}
        <a download="haseef-employees-template.csv" href={`data:text/csv;charset=utf-8,﻿${encodeURIComponent(CSV_TEMPLATE)}`}>تنزيل نموذج</a></p>
      <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
      <textarea rows={4} dir="auto" placeholder="أو الصق هنا…" value={text} onChange={(e) => setText(e.target.value)} />
      {parsed && <p className="small">{parsed.rows.length} صفاً صالحاً{parsed.errors.length > 0 && <span className="late"> · {parsed.errors.join(" · ")}</span>}</p>}
      <div><button className="btn btn-action" type="button" disabled={!parsed?.rows.length}
        onClick={() => parsed && onDone(parsed.rows as unknown as EmployeeInput[])}>استيراد {parsed?.rows.length ?? 0}</button></div>
    </div>
  );
}

// ------------------------------------------------------------------ التأمينات الاجتماعية
function GosiTab({ canSeeWages }: { canSeeWages: boolean }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [g, setG] = useState<GosiMonth | null>(null);
  const [rates, setRates] = useState<GosiRate[]>([]);
  const [calc, setCalc] = useState({ nationality: "SAUDI", gosi_system: "NEW", basic_wage: 8000, housing_allowance: 2000 });
  const [res, setRes] = useState<GosiCalcResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (canSeeWages) api.gosiMonth(month).then(setG).catch(() => setG(null)); }, [month, canSeeWages]);
  useEffect(() => { api.gosiRates().then(setRates).catch(() => {}); }, []);

  return (
    <section className="gov-section" style={{ marginTop: 8 }}>
      {canSeeWages && (
        <>
          <div className="head-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h2>اشتراكات الشهر</h2>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="الشهر" />
          </div>
          {g && (
            <>
              <dl className="obl-stats">
                <div><dt>حصة الموظفين (تُستقطع من الراتب)</dt><dd className="num-dd">{sar(g.employee_total)}</dd></div>
                <div><dt>حصة المنشأة</dt><dd className="num-dd">{sar(g.employer_total)}</dd></div>
                <div><dt>الإجمالي المستحق</dt><dd className="num-dd">{sar(g.total)}</dd></div>
              </dl>
              <div className="table-scroll">
                <table className="deadlines labor-table">
                  <thead><tr><th>الموظف</th><th className="num">الأجر الخاضع</th><th className="num">الموظف</th><th className="num">المنشأة</th><th className="num">الإجمالي</th></tr></thead>
                  <tbody>{g.lines.map((l) => (
                    <tr key={l.employee_id}>
                      <td>{l.full_name}<div className="small muted">{l.nationality === "SAUDI" ? SYSTEM_LABEL[l.gosi_system] : "غير سعودي"} · {l.employee_pct}% + {l.employer_pct}%
                        {!l.gosi_registered && <span className="late"> · غير مسجّل</span>}</div></td>
                      <td className="num">{sar(l.base)}</td><td className="num">{sar(l.employee)}</td><td className="num">{sar(l.employer)}</td><td className="num">{sar(l.total)}</td>
                    </tr>))}</tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      <h2 style={{ marginTop: 24 }}>حاسبة الاشتراك</h2>
      <form className="panel inline-form" onSubmit={async (e) => { e.preventDefault(); setErr(null);
        try { setRes(await api.gosiCalc(calc)); } catch (x) { setErr(x instanceof Error ? x.message : "تعذّر الحساب"); } }}>
        <div className="grid">
          <div className="field"><label>الجنسية</label><select value={calc.nationality} onChange={(e) => setCalc({ ...calc, nationality: e.target.value })}>
            <option value="SAUDI">سعودي</option><option value="NON_SAUDI">غير سعودي</option></select></div>
          {calc.nationality === "SAUDI" && <div className="field"><label>النظام</label><select value={calc.gosi_system} onChange={(e) => setCalc({ ...calc, gosi_system: e.target.value })}>
            <option value="NEW">الجديد</option><option value="OLD">السابق</option></select></div>}
          <div className="field"><label>الراتب الأساسي</label><input type="number" min={0} value={calc.basic_wage} onChange={(e) => setCalc({ ...calc, basic_wage: Number(e.target.value) })} /></div>
          <div className="field"><label>بدل السكن</label><input type="number" min={0} value={calc.housing_allowance} onChange={(e) => setCalc({ ...calc, housing_allowance: Number(e.target.value) })} /></div>
        </div>
        <div><button className="btn btn-action" type="submit">احسب</button></div>
        {err && <p className="error">{err}</p>}
        {res && <p className="calc-out">الأجر الخاضع {sar(res.base)} · على الموظف <b>{sar(res.employee)}</b> ({res.employee_pct}%) · على المنشأة <b>{sar(res.employer)}</b> ({res.employer_pct}%) · الإجمالي <b>{sar(res.total)}</b></p>}
      </form>

      <h2 style={{ marginTop: 24 }}>النسب المعتمدة</h2>
      <div className="table-scroll">
        <table className="deadlines labor-table">
          <thead><tr><th>النظام</th><th>يسري من</th><th className="num">الموظف</th><th className="num">المنشأة</th><th>ملاحظة</th></tr></thead>
          <tbody>{rates.map((r) => (
            <tr key={r.system + r.effective_from}>
              <td>{SYSTEM_LABEL[r.system]}</td><td>{formatDate(r.effective_from)}</td>
              <td className="num">{r.employee_annuity + r.employee_saned}%</td>
              <td className="num">{r.employer_annuity + r.employer_saned + r.employer_hazards}%</td>
              <td className="small muted">{r.note}</td>
            </tr>))}</tbody>
        </table>
      </div>
      <p className="small muted">الأجر الخاضع = الأساسي + بدل السكن، بحد أدنى 1,500 وأعلى 45,000 ريال. النسب تشمل المعاشات وساند (0.75% لكل طرف) والأخطار المهنية (2% على المنشأة).
        المرجع النهائي حساب المنشأة في <a href="https://www.gosi.gov.sa" target="_blank" rel="noreferrer">التأمينات الاجتماعية</a>.</p>
    </section>
  );
}

// ------------------------------------------------------------------ قوى ونطاقات
function QiwaTab({ ov, act }: { ov: LaborOverview; act: Act }) {
  const [p, setP] = useState<LaborProfile>(ov.profile ?? { salary_day: 27, nitaqat_band: null, nitaqat_checked_on: null, gosi_employer_no: null });
  const ind = ov.indicators;
  return (
    <section className="gov-section" style={{ marginTop: 8 }}>
      {ind ? (
        <div className="qiwa-grid">
          <div className="panel"><h3>نسبة السعودة</h3><p className="big">{ind.saudization_pct}%</p>
            <p className="small muted">{ind.saudis} سعودي من {ind.employees}. النطاق الرسمي يحسبه قوى حسب النشاط والحجم؛ سجّله أدناه لتتابعه.</p></div>
          <div className="panel"><h3>توثيق العقود في قوى</h3><p className="big" data-s={ind.documented_pct === 100 ? "IN_PLACE" : "PENDING"}>{ind.documented_pct}%</p>
            <p className="small muted">{ind.employees - ind.documented > 0 ? `${ind.employees - ind.documented} عقد غير موثق — وثّقها من حساب المنشأة في قوى.` : "كل العقود موثقة."}</p></div>
          <div className="panel"><h3>التسجيل في التأمينات</h3><p className="big" data-s={ind.gosi_unregistered ? "LATE" : "IN_PLACE"}>{ind.gosi_registered}/{ind.employees}</p>
            <p className="small muted">{ind.gosi_unregistered ? `${ind.gosi_unregistered} موظف غير مسجّل: التسجيل إلزامي من أول يوم عمل.` : "كل الموظفين مسجّلون."}</p></div>
          <div className="panel"><h3>غرامة عدم رفع ملف الأجور</h3><p className="big">{sar(ind.wps_fine_if_missed)}</p>
            <p className="small muted">لكل شهر لا يُرفع فيه ملف حماية الأجور في مُدد، حسب عدد موظفيك.</p></div>
        </div>
      ) : <p className="hint-box">{UPSELL}</p>}

      <form className="panel inline-form" style={{ marginTop: 16 }} onSubmit={(e) => { e.preventDefault(); act(() => api.setLaborProfile(p), "حُفظت بيانات المنشأة"); }}>
        <h2>بيانات المنشأة العمالية</h2>
        <div className="grid">
          <div className="field"><label>يوم صرف الرواتب</label><input type="number" min={1} max={28} required disabled={!ov.can_manage} value={p.salary_day}
            onChange={(e) => setP({ ...p, salary_day: Number(e.target.value) })} /></div>
          <div className="field"><label>نطاق نطاقات الحالي</label><select disabled={!ov.can_manage} value={p.nitaqat_band ?? ""} onChange={(e) => setP({ ...p, nitaqat_band: e.target.value || null })}>
            <option value="">غير محدد</option>{Object.entries(NITAQAT_BAND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="field"><label>تاريخ آخر تحقق من قوى</label><input type="date" disabled={!ov.can_manage} value={p.nitaqat_checked_on ?? ""}
            onChange={(e) => setP({ ...p, nitaqat_checked_on: e.target.value || null })} /></div>
          <div className="field"><label>رقم المنشأة في التأمينات</label><input dir="ltr" maxLength={20} disabled={!ov.can_manage} value={p.gosi_employer_no ?? ""}
            onChange={(e) => setP({ ...p, gosi_employer_no: e.target.value || null })} /></div>
        </div>
        {(p.nitaqat_band === "RED" || p.nitaqat_band === "YELLOW") && <p className="hint-box">النطاق {NITAQAT_BAND[p.nitaqat_band]} يقيّد إصدار التأشيرات وتجديد رخص العمل ونقل الخدمات. راجع خطة التوطين مع مستشارك.</p>}
        {ov.can_manage && <div><button className="btn btn-action" type="submit">حفظ</button></div>}
      </form>
    </section>
  );
}
