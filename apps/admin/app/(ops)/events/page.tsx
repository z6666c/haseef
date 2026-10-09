"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDate, type AnnualEvent, type AnnualEventInput } from "@haseef/shared";
import { api } from "@/lib/session";

const KIND: Record<string, string> = { NATIONAL: "وطنية", RELIGIOUS: "دينية", OCCASION: "مناسبة" };
const EMPTY: AnnualEventInput = { code: "", name: "", event_date: "", kind: "OCCASION", is_holiday: false, holiday_days: 0, greeting: "", notify_subscribers: true, is_active: true };

export default function EventsAdminPage() {
  const [d, setD] = useState<{ events: AnnualEvent[]; orgs_enabled: number } | null>(null);
  const [edit, setEdit] = useState<(AnnualEventInput & { id?: string }) | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { api.admin.events().then(setD).catch((e: Error) => setError(e.message)); }, []);
  useEffect(load, [load]);
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!edit) return;
    setError(null); setNotice(null);
    const { id, ...b } = edit;
    try { await (id ? api.admin.editEvent(id, b) : api.admin.addEvent(b)); setNotice(`حُفظت «${b.name}»`); setEdit(null); load(); }
    catch (x) { setError(x instanceof Error ? x.message : "تعذّر الحفظ"); }
  }
  if (!d) return error ? <p className="error">{error}</p> : null;
  return (
    <>
      <h1>المناسبات السنوية</h1>
      <p className="muted">تقويم المناسبات الذي يراه كل العملاء، والعطل الرسمية التي تُستثنى من الغياب والإجازات. صباح يوم المناسبة (09:05) تُرسل تهنئة واتساب لمشتركي حصيف
        إن فُعّل ذلك للمناسبة، ولموظفي المنشآت التي فعّلت التهاني ({d.orgs_enabled} منشأة). التواريخ الهجرية وفق أم القرى؛ عدّلها عند إعلان الرؤية.</p>
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {!edit && <button className="btn" type="button" onClick={() => setEdit({ ...EMPTY })}>إضافة مناسبة</button>}
      {edit && (
        <form className="form-card" onSubmit={save} style={{ marginTop: 12 }}>
          <h2>{edit.id ? "تعديل المناسبة" : "مناسبة جديدة"}</h2>
          <div className="grid">
            <div className="field"><label htmlFor="en">الاسم</label><input id="en" required minLength={2} maxLength={120} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="ec">الرمز</label><input id="ec" dir="ltr" required pattern="[A-Z0-9_]{2,30}" placeholder="EID_FITR" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} /></div>
            <div className="field"><label htmlFor="ed">التاريخ</label><input id="ed" type="date" required value={edit.event_date} onChange={(e) => setEdit({ ...edit, event_date: e.target.value })} /></div>
            <div className="field"><label htmlFor="ek">النوع</label><select id="ek" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as AnnualEventInput["kind"] })}>
              {Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div className="field"><label htmlFor="eh">أيام العطلة الرسمية</label><input id="eh" type="number" min={0} max={14} value={edit.holiday_days}
              onChange={(e) => setEdit({ ...edit, holiday_days: Number(e.target.value) || 0, is_holiday: Number(e.target.value) > 0 })} /></div>
          </div>
          <div className="field"><label htmlFor="eg">نص التهنئة</label><textarea id="eg" rows={2} required minLength={5} maxLength={500} value={edit.greeting} onChange={(e) => setEdit({ ...edit, greeting: e.target.value })} /></div>
          <label className="check-row"><input type="checkbox" checked={edit.notify_subscribers} onChange={(e) => setEdit({ ...edit, notify_subscribers: e.target.checked })} /> أرسل التهنئة لمشتركي حصيف</label>
          <label className="check-row"><input type="checkbox" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} /> ظاهرة في التقويم</label>
          <div style={{ display: "flex", gap: 8 }}><button className="btn btn-action" type="submit">حفظ</button><button className="btn btn-quiet" type="button" onClick={() => setEdit(null)}>إلغاء</button></div>
        </form>
      )}
      <table className="table" style={{ marginTop: 16 }}>
        <thead><tr><th>المناسبة</th><th>التاريخ</th><th>عطلة</th><th>التهنئة</th><th>أُرسلت</th><th><span className="sr-only">تعديل</span></th></tr></thead>
        <tbody>{d.events.map((e) => (
          <tr key={e.id} style={e.is_active ? undefined : { opacity: 0.55 }}>
            <td><b>{e.name}</b><div className="small muted">{KIND[e.kind]} · {e.code}</div></td>
            <td>{formatDate(e.event_date)}</td>
            <td>{e.is_holiday ? `${e.holiday_days} يوم` : "—"}</td>
            <td className="small">{e.greeting}<div className="muted">{e.notify_subscribers ? "تُرسل للمشتركين" : "لا تُرسل للمشتركين"}</div></td>
            <td className="small">{e.sent_subscribers ?? 0} مشترك · {e.sent_employees ?? 0} موظف</td>
            <td><button className="link-btn" type="button" onClick={() => setEdit({ id: e.id, code: e.code, name: e.name, event_date: e.event_date, kind: e.kind, is_holiday: e.is_holiday,
              holiday_days: e.holiday_days, greeting: e.greeting, notify_subscribers: e.notify_subscribers, is_active: e.is_active })}>تعديل</button></td>
          </tr>))}</tbody>
      </table>
    </>
  );
}
