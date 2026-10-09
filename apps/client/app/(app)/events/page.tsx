"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDate, type EventsView } from "@haseef/shared";
import { api } from "@/lib/session";

const KIND: Record<string, string> = { NATIONAL: "وطنية", RELIGIOUS: "دينية", OCCASION: "مناسبة" };
const daysTo = (d: string) => {
  const t = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  return Math.round((new Date(`${d}T00:00:00Z`).getTime() - new Date(`${t}T00:00:00Z`).getTime()) / 86_400_000);
};

export default function EventsPage() {
  const [v, setV] = useState<EventsView | null>(null);
  const [s, setS] = useState<EventsView["settings"] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { api.events().then((x) => { setV(x); setS(x.settings); }).catch((e: Error) => setErr(e.message)); }, []);
  useEffect(load, [load]);
  if (!v || !s) return err ? <p className="error">{err}</p> : <div className="boot" aria-busy="true" />;
  const codes = [...new Set(v.events.map((e) => e.code))];
  const nameOf = (c: string) => v.events.find((e) => e.code === c)?.name.replace(/ \d{4}$/, "") ?? c;
  async function save() {
    setMsg(null); setErr(null);
    try { await api.eventsSettings({ enabled: s!.enabled, signature: s!.signature || null, excluded_codes: s!.excluded_codes }); setMsg("حُفظت الإعدادات"); load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "تعذّر"); }
  }
  return (
    <>
      <header className="page-head">
        <h1>تقويم المناسبات</h1>
        <p className="muted">المناسبات الوطنية والدينية والعطل الرسمية للسنة. العطل تُستثنى تلقائياً من حساب الغياب وأيام الإجازة. التواريخ الهجرية وفق تقويم أم القرى وتُحدَّث عند إعلان الرؤية.</p>
      </header>
      {msg && <p className="notice" role="status">{msg}</p>}
      {err && <p className="error" role="alert">{err}</p>}
      <section className="panel inline-form" style={{ maxWidth: 720 }}>
        <h2>تهنئة موظفيك على واتساب</h2>
        <p className="small">يرسل حصيف صباح يوم المناسبة تهنئة باسم منشأتك لكل موظف لديه جوال في سجله أو مربوط ببوت الموظفين. الخدمة مجانية واختيارية.</p>
        <label className="checks-inline"><input type="checkbox" disabled={!v.can_manage} checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} /> أرسل التهاني لموظفي {v.org_name}</label>
        <div className="field"><label htmlFor="sg">التوقيع</label>
          <input id="sg" maxLength={120} disabled={!v.can_manage} placeholder={`إدارة ${v.org_name}`} value={s.signature ?? ""} onChange={(e) => setS({ ...s, signature: e.target.value })} /></div>
        <fieldset className="field"><legend>المناسبات المشمولة</legend>
          <div className="chip-row">{codes.map((c) => (
            <label key={c} className="checks-inline"><input type="checkbox" disabled={!v.can_manage} checked={!s.excluded_codes.includes(c)}
              onChange={(e) => setS({ ...s, excluded_codes: e.target.checked ? s.excluded_codes.filter((x) => x !== c) : [...s.excluded_codes, c] })} /> {nameOf(c)}</label>))}</div>
        </fieldset>
        <p className="small muted">يصل التهنئة {v.reachable_employees} موظفاً حالياً. أضف جوالات الموظفين من «العمل والموظفين».</p>
        {v.can_manage && <div><button className="btn btn-action" type="button" onClick={save}>حفظ</button></div>}
      </section>
      <table className="deadlines labor-table" style={{ marginTop: 16 }}>
        <thead><tr><th>المناسبة</th><th>التاريخ</th><th>عطلة رسمية</th><th>نص التهنئة</th></tr></thead>
        <tbody>{v.events.map((e) => {
          const n = daysTo(e.event_date);
          return (
            <tr key={e.id}>
              <td><b>{e.name}</b><div className="small muted">{KIND[e.kind]}</div></td>
              <td>{formatDate(e.event_date)}<div className="small muted">{n === 0 ? "اليوم" : n === 1 ? "غداً" : n > 0 ? `بعد ${n} يوماً` : "أمس"}</div></td>
              <td>{e.is_holiday ? <span className="status-chip" data-s="IN_PLACE">{e.holiday_days} يوم</span> : "—"}</td>
              <td className="small">{e.greeting}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </>
  );
}
