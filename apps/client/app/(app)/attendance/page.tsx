"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { WEEKDAYS, formatDate, sar, type AttendanceOverview, type AttendanceReport, type SiteInput } from "@haseef/shared";
import { api } from "@/lib/session";

type Tab = "today" | "sites" | "report" | "settings";
type Act = (fn: () => Promise<unknown>, ok: string) => Promise<boolean>;
const fmtTime = (d: string | null) => d ? new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { timeStyle: "short", timeZone: "Asia/Riyadh" }).format(new Date(d)) : "—";
const fmtDT = (d: string) => new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" }).format(new Date(d));
const thisMonth = () => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "Asia/Riyadh" }).format(new Date()).slice(0, 7);

export default function AttendancePage() {
  const [ov, setOv] = useState<AttendanceOverview | null>(null);
  const [tab, setTab] = useState<Tab>("today");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { api.attendanceOverview().then(setOv).catch((e: Error) => setError(e.message)); }, []);
  useEffect(load, [load]);
  const act: Act = async (fn, ok) => {
    setError(null); setNotice(null);
    try { await fn(); setNotice(ok); load(); return true; } catch (e) { setError(e instanceof Error ? e.message : "تعذّر"); return false; }
  };
  if (!ov) return error ? <p className="error">{error}</p> : <div className="boot" aria-busy="true" />;

  if (!ov.access.via) {
    return (
      <>
        <header className="page-head"><h1>الحضور والانصراف بالموقع</h1></header>
        <section className="panel inline-form" style={{ maxWidth: 680 }}>
          <p>يسجّل الموظف حضوره وانصرافه من جواله برابط شخصي، ولا يُقبل التسجيل إلا إذا كان داخل نطاق موقع المنشأة الذي تحدده، وبعد التحقق ببصمة جواله أو وجهه.</p>
          <ul className="labor-rules">
            <li>بلا تطبيق ولا جهاز بصمة: متصفح الجوال يكفي.</li>
            <li>البصمة لا تغادر جوال الموظف؛ حصيف يحفظ مفتاحاً عاماً فقط يثبت أن الجوال المسجّل هو من وقّع.</li>
            <li>الموقع يُلتقط لحظة التسجيل فقط، وتُحذف الإحداثيات تلقائياً بعد مدة الاحتفاظ.</li>
            <li>تقرير شهري بالتأخير والغياب، وتنبيه على المحاولات المرفوضة والمشبوهة.</li>
          </ul>
          <p className="price"><b>{ov.access.price != null ? sar(ov.access.price) : "—"}</b> <span className="muted small">شهرياً قبل الضريبة لباقتك الحالية</span></p>
          {ov.can_manage ? <Link className="btn btn-action" href="/billing">اشترك في خدمة الحضور</Link> : <p className="hint-box">يفعّلها مدير المنشأة من «الاشتراك والدفعات».</p>}
        </section>
      </>
    );
  }

  const people = ov.people ?? [];
  const inNow = people.filter((p) => p.in_at).length;
  const late = people.filter((p) => (p.late_minutes ?? 0) > 0).length;
  return (
    <>
      <header className="page-head">
        <h1>الحضور والانصراف بالموقع</h1>
        <p className="muted">تسجيل من جوال الموظف داخل نطاق المنشأة مع التحقق ببصمة الجوال.
          {ov.access.via === "PLAN" ? " مشمول في باقتك." : ov.access.paid_until ? ` اشتراكك ساري حتى ${formatDate(ov.access.paid_until.slice(0, 10))}.` : ""}</p>
      </header>
      {(ov.sites ?? []).length === 0 && <p className="hint-box">ابدأ بإضافة موقع المنشأة من تبويب «المواقع»، ثم أرسل لكل موظف رابطه الشخصي.</p>}
      <dl className="obl-stats labor-stats">
        <div><dt>حضروا اليوم</dt><dd data-s="IN_PLACE">{inNow}<small className="muted"> / {people.length}</small></dd></div>
        <div><dt>متأخرون اليوم</dt><dd data-s={late ? "PENDING" : undefined}>{late}</dd></div>
        <div><dt>أجهزة مربوطة</dt><dd>{people.filter((p) => p.device_since).length}{ov.limit ? <small className="muted"> / {ov.limit}</small> : null}</dd></div>
        <div><dt>مواقع</dt><dd>{(ov.sites ?? []).filter((s) => s.is_active).length}</dd></div>
      </dl>
      <div className="tabs-row">
        <div className="filters" role="tablist">
          {([["today", "اليوم والموظفون"], ["sites", "المواقع"], ["report", "التقرير الشهري"], ["settings", "الإعدادات"]] as [Tab, string][]).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>))}
        </div>
      </div>
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {tab === "today" && <TodayTab ov={ov} act={act} />}
      {tab === "sites" && <SitesTab ov={ov} act={act} />}
      {tab === "report" && <ReportTab />}
      {tab === "settings" && <SettingsTab ov={ov} act={act} />}
    </>
  );
}

function TodayTab({ ov, act }: { ov: AttendanceOverview; act: Act }) {
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  async function issue(id: string, name: string) {
    const ok = await act(async () => { const r = await api.attendanceLink(id); setLink({ name, url: r.url }); setCopied(false); }, `أُنشئ رابط ${name}`);
    return ok;
  }
  return (
    <section className="gov-section" style={{ marginTop: 8 }}>
      {link && (
        <div className="panel inline-form" style={{ marginBottom: 12 }}>
          <h2>رابط {link.name}</h2>
          <p className="small muted">أرسله للموظف وحده (واتساب أو رسالة). الرابط الجديد يُبطل السابق. يستطيع الموظف أيضاً طلبه بكتابة «حضور» لبوت الموظفين.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <code className="code-box" dir="ltr" style={{ wordBreak: "break-all" }}>{link.url}</code>
            <button className="btn btn-xs" type="button" onClick={() => navigator.clipboard?.writeText(link.url).then(() => setCopied(true))}>{copied ? "نُسخ ✓" : "نسخ"}</button>
            <a className="btn btn-quiet btn-xs" href={link.url} target="_blank" rel="noreferrer">افتح</a>
          </div>
        </div>
      )}
      <table className="deadlines labor-table">
        <thead><tr><th>الموظف</th><th>اليوم</th><th>الجهاز</th><th /></tr></thead>
        <tbody>{(ov.people ?? []).map((p) => (
          <tr key={p.employee_id}>
            <td><b>{p.full_name}</b>{p.job_title && <div className="small muted">{p.job_title}</div>}</td>
            <td>{p.in_at ? <>
              <span className="status-chip" data-s={(p.late_minutes ?? 0) > 0 ? "PENDING" : "IN_PLACE"}>حضور {fmtTime(p.in_at)}</span>
              {(p.late_minutes ?? 0) > 0 && <div className="small muted">تأخر {p.late_minutes} دقيقة</div>}
              {p.out_at && <div className="small muted">انصراف {fmtTime(p.out_at)}</div>}</> : <span className="muted small">لم يسجّل</span>}</td>
            <td>{p.device_since ? <><span className="status-chip" data-s="IN_PLACE">مربوط</span><div className="small muted">{p.device_label ?? "جوال"} · منذ {formatDate(p.device_since.slice(0, 10))}</div></>
              : <span className="muted small">{p.has_link ? "أُرسل الرابط ولم يُربط" : "—"}</span>}</td>
            <td>{ov.can_manage && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button className="btn btn-action btn-xs" type="button" onClick={() => issue(p.employee_id, p.full_name)}>{p.has_link ? "رابط جديد" : "إنشاء رابط"}</button>
              {p.device_since && <button className="btn btn-quiet btn-xs" type="button" onClick={() => act(() => api.revokeDevice(p.employee_id), `فُكّ ربط جهاز ${p.full_name}`)}>فك ربط الجهاز</button>}
            </div>}</td>
          </tr>))}
          {(ov.people ?? []).length === 0 && <tr><td colSpan={4} className="muted">لا موظفين بعد. <Link href="/labor">أضفهم من «العمل والموظفين»</Link>.</td></tr>}
        </tbody>
      </table>
      <h2 style={{ marginTop: 20 }}>آخر التسجيلات</h2>
      <table className="deadlines labor-table">
        <thead><tr><th>الموظف</th><th>النوع</th><th>النتيجة</th><th>الوقت</th></tr></thead>
        <tbody>{(ov.recent ?? []).slice(0, 25).map((r) => (
          <tr key={r.id}>
            <td>{r.full_name}</td>
            <td>{r.kind === "IN" ? "حضور" : "انصراف"}</td>
            <td>{r.status === "ACCEPTED"
              ? <span className="status-chip" data-s="IN_PLACE">مقبول{r.site_name ? ` · ${r.site_name}` : ""}</span>
              : <span className="status-chip" data-s="FAIL">مرفوض: {r.reason_label ?? r.reason}</span>}
              <div className="small muted">{r.distance_m != null && `على بعد ${Math.round(r.distance_m)} م`}{r.accuracy_m != null && ` · دقة ±${Math.round(r.accuracy_m)} م`}
                {(r.late_minutes ?? 0) > 0 && ` · تأخر ${r.late_minutes} د`}</div>
              {r.flag_labels.length > 0 && <div className="small" style={{ color: "var(--amber, #b45309)" }}>⚑ {r.flag_labels.join("، ")}</div>}</td>
            <td className="small">{fmtDT(r.at)}</td>
          </tr>))}
          {(ov.recent ?? []).length === 0 && <tr><td colSpan={4} className="muted">لا تسجيلات بعد.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

const EMPTY: SiteInput = { name: "", lat: 0, lng: 0, radius_m: 100, max_accuracy_m: 100, is_active: true };

function SitesTab({ ov, act }: { ov: AttendanceOverview; act: Act }) {
  const [edit, setEdit] = useState<(SiteInput & { id?: string }) | null>(null);
  const [geo, setGeo] = useState<string | null>(null);
  function here() {
    if (!navigator.geolocation) { setGeo("متصفحك لا يدعم تحديد الموقع."); return; }
    setGeo("جارٍ تحديد موقعك…");
    navigator.geolocation.getCurrentPosition(
      (p) => { setEdit((e) => e && { ...e, lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }); setGeo(`حُدد موقعك بدقة ±${Math.round(p.coords.accuracy)} م. قف داخل المبنى عند الحفظ لنتيجة أدق.`); },
      (e) => setGeo(e.code === 1 ? "رُفض إذن الموقع. فعّله من إعدادات المتصفح." : "تعذّر تحديد الموقع."),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!edit) return;
    const { id, ...b } = edit;
    if (await act(() => (id ? api.editSite(id, b) : api.addSite(b)), id ? "حُفظ الموقع" : "أُضيف الموقع")) { setEdit(null); setGeo(null); }
  }
  return (
    <section className="gov-section" style={{ marginTop: 8 }}>
      <p className="small muted">نطاق الموقع دائرة حول نقطة المبنى. ننصح بنصف قطر 100 متر: دقة GPS داخل المباني تتراوح عادة بين 10 و50 متراً، والنطاق الأضيق يرفض موظفين حاضرين فعلاً.</p>
      {ov.can_manage && !edit && <button className="btn btn-action" type="button" onClick={() => { setEdit({ ...EMPTY }); setGeo(null); }}>إضافة موقع</button>}
      {edit && (
        <form className="panel inline-form" onSubmit={save} style={{ marginTop: 8 }}>
          <h2>{edit.id ? "تعديل الموقع" : "موقع جديد"}</h2>
          <div className="grid">
            <div className="field field-wide"><label htmlFor="sn">الاسم</label><input id="sn" required minLength={2} maxLength={150} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="المقر الرئيسي" /></div>
            <div className="field"><label htmlFor="la">خط العرض</label><input id="la" dir="ltr" type="number" step="any" required min={-90} max={90} value={edit.lat || ""} onChange={(e) => setEdit({ ...edit, lat: +e.target.value })} /></div>
            <div className="field"><label htmlFor="ln">خط الطول</label><input id="ln" dir="ltr" type="number" step="any" required min={-180} max={180} value={edit.lng || ""} onChange={(e) => setEdit({ ...edit, lng: +e.target.value })} /></div>
            <div className="field"><label htmlFor="rd">نصف القطر (متر)</label><input id="rd" type="number" required min={20} max={2000} value={edit.radius_m} onChange={(e) => setEdit({ ...edit, radius_m: +e.target.value })} /></div>
            <div className="field"><label htmlFor="ac">أقصى خطأ مقبول في الدقة (متر)</label><input id="ac" type="number" required min={10} max={500} value={edit.max_accuracy_m} onChange={(e) => setEdit({ ...edit, max_accuracy_m: +e.target.value })} /></div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btn-xs" type="button" onClick={here}>📍 استخدم موقعي الحالي</button>
            {geo && <span className="small muted">{geo}</span>}
          </div>
          {edit.radius_m < 50 && <p className="hint-box">نطاق أقل من 50 متراً قد يرفض موظفين داخل المبنى بسبب ضعف دقة GPS في الأماكن المغلقة.</p>}
          {edit.lat !== 0 && edit.lng !== 0 && <MapPreview lat={edit.lat} lng={edit.lng} r={edit.radius_m} />}
          <label className="checks-inline"><input type="checkbox" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} /> الموقع فعّال</label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-action" type="submit">حفظ</button>
            <button className="btn btn-quiet" type="button" onClick={() => { setEdit(null); setGeo(null); }}>إلغاء</button>
          </div>
        </form>
      )}
      <ul className="ropa-list" style={{ marginTop: 12 }}>{(ov.sites ?? []).map((s) => (
        <li key={s.id}>
          <div className="res-head"><strong>{s.name}</strong>{!s.is_active && <span className="tag tag-quiet">موقوف</span>}</div>
          <p className="small muted" dir="ltr" style={{ textAlign: "start" }}>{s.lat.toFixed(5)}, {s.lng.toFixed(5)}</p>
          <p className="small">نطاق {s.radius_m} م · دقة مقبولة حتى ±{s.max_accuracy_m} م</p>
          <MapPreview lat={s.lat} lng={s.lng} r={s.radius_m} />
          {ov.can_manage && <div style={{ display: "flex", gap: 10 }}>
            <button className="link-btn" type="button" onClick={() => { setEdit({ ...s }); setGeo(null); }}>تعديل</button>
            {s.is_active && <button className="link-btn" type="button" onClick={() => act(() => api.deleteSite(s.id), `أُوقف «${s.name}»`)}>إيقاف</button>}</div>}
        </li>))}</ul>
    </section>
  );
}

function MapPreview({ lat, lng, r }: { lat: number; lng: number; r: number }) {
  const d = Math.max(r * 3, 300) / 111_320;
  const dl = d / Math.cos((lat * Math.PI) / 180);
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - dl},${lat - d},${lng + dl},${lat + d}&layer=mapnik&marker=${lat},${lng}`;
  return <iframe title="خريطة الموقع" src={src} loading="lazy" style={{ width: "100%", maxWidth: 520, height: 220, border: "1px solid var(--line, #ddd)", borderRadius: 8 }} />;
}

function ReportTab() {
  const [month, setMonth] = useState(thisMonth());
  const [rep, setRep] = useState<AttendanceReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setRep(null); api.attendanceReport(month).then(setRep).catch((e: Error) => setErr(e.message)); }, [month]);
  function csv() {
    if (!rep) return;
    const head = ["الموظف", "أيام الحضور", "أيام العمل", "أيام الغياب", "أيام التأخير", "دقائق التأخير", "محاولات مرفوضة", "تسجيلات مُعلَّمة"];
    const lines = [head, ...rep.rows.map((r) => [r.full_name, r.days_present, rep.workdays, r.absent_days, r.late_days, r.late_minutes, r.rejected, r.flagged])]
      .map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(","));
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `attendance-${rep.month}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  return (
    <section className="gov-section" style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap", marginBottom: 8 }}>
        <div className="field"><label htmlFor="rm">الشهر</label><input id="rm" type="month" value={month} max={thisMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} /></div>
        <button className="btn btn-quiet" type="button" disabled={!rep} onClick={csv}>تصدير CSV</button>
      </div>
      {err && <p className="error">{err}</p>}
      {!rep ? <div className="boot" aria-busy="true" /> : (
        <>
          <p className="small muted">أيام العمل حتى اليوم في هذا الشهر: {rep.workdays}</p>
          <table className="deadlines labor-table">
            <thead><tr><th>الموظف</th><th>حضور</th><th>غياب</th><th>تأخير</th><th>مرفوضة / مُعلَّمة</th></tr></thead>
            <tbody>{rep.rows.map((r) => (
              <tr key={r.id}><td>{r.full_name}</td><td>{r.days_present}</td>
                <td>{r.absent_days ? <span className="status-chip" data-s="PENDING">{r.absent_days}</span> : 0}</td>
                <td>{r.late_days ? `${r.late_days} يوم · ${r.late_minutes} د` : "—"}</td>
                <td>{r.rejected} / {r.flagged}</td></tr>))}
              {rep.rows.length === 0 && <tr><td colSpan={5} className="muted">لا بيانات.</td></tr>}</tbody>
          </table>
        </>
      )}
    </section>
  );
}

function SettingsTab({ ov, act }: { ov: AttendanceOverview; act: Act }) {
  const [v, setV] = useState({ ...ov.settings!, work_start: ov.settings!.work_start.slice(0, 5), work_end: ov.settings!.work_end.slice(0, 5) });
  const dis = !ov.can_manage;
  const toggleDay = (d: number) => setV({ ...v, work_days: v.work_days.includes(d) ? v.work_days.filter((x) => x !== d) : [...v.work_days, d].sort() });
  return (
    <form className="panel inline-form" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); act(() => api.attendanceSettings(v), "حُفظت الإعدادات"); }}>
      <div className="grid">
        <div className="field"><label htmlFor="ws">بداية الدوام</label><input id="ws" type="time" required disabled={dis} value={v.work_start} onChange={(e) => setV({ ...v, work_start: e.target.value })} /></div>
        <div className="field"><label htmlFor="we">نهاية الدوام</label><input id="we" type="time" required disabled={dis} value={v.work_end} onChange={(e) => setV({ ...v, work_end: e.target.value })} /></div>
        <div className="field"><label htmlFor="gr">سماحية التأخير (دقيقة)</label><input id="gr" type="number" min={0} max={120} required disabled={dis} value={v.grace_minutes} onChange={(e) => setV({ ...v, grace_minutes: +e.target.value })} /></div>
        <div className="field"><label htmlFor="rt">الاحتفاظ بالإحداثيات (يوم)</label><input id="rt" type="number" min={7} max={365} required disabled={dis} value={v.retention_days} onChange={(e) => setV({ ...v, retention_days: +e.target.value })} /></div>
      </div>
      <fieldset className="field"><legend>أيام العمل</legend>
        <div className="chip-row">{WEEKDAYS.map((d, i) => (
          <label key={i} className="checks-inline"><input type="checkbox" disabled={dis} checked={v.work_days.includes(i)} onChange={() => toggleDay(i)} /> {d}</label>))}</div>
      </fieldset>
      <label className="checks-inline"><input type="checkbox" disabled={dis} checked={v.require_device} onChange={(e) => setV({ ...v, require_device: e.target.checked })} /> اشترط التحقق ببصمة الجوال المربوط (موصى به لمنع التسجيل نيابة عن الغير)</label>
      <p className="small muted">بعد مدة الاحتفاظ تُحذف الإحداثيات ويبقى وقت الحضور والنتيجة فقط، وفق نظام حماية البيانات الشخصية. أُضيف «تسجيل الحضور بالموقع» إلى سجل أنشطة المعالجة تلقائياً.</p>
      {!dis && <div><button className="btn btn-action" type="submit">حفظ</button></div>}
    </form>
  );
}
