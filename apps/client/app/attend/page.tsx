"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LEAVE_STATUS, NOTICE_STATUS, KIND_LABEL, fmtDays, formatDate, registerDevice, sar, signWithDevice, webauthnSupported,
  type AttendCheckResult, type AttendPage, type LeaveAttachment, type LeaveType, type PersonHr } from "@haseef/shared";
import { AttachPicker } from "@/components/AttachPicker";
import { Logo } from "@/components/Logo";
import { api } from "@/lib/session";

const fmtTime = (d: string) => new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { timeStyle: "short", timeZone: "Asia/Riyadh" }).format(new Date(d));

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((ok, fail) => {
    if (!navigator.geolocation) { fail(new Error("متصفحك لا يدعم تحديد الموقع.")); return; }
    navigator.geolocation.getCurrentPosition(ok, (e) => fail(new Error(
      e.code === 1 ? "رُفض إذن الموقع. اسمح للمتصفح بالوصول إلى موقعك ثم أعد المحاولة." : e.code === 3 ? "انتهت مهلة تحديد الموقع. اقترب من نافذة وأعد المحاولة." : "تعذّر تحديد موقعك.")),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  });
}

function Attend() {
  const qs = useSearchParams();
  const token = qs.get("t") ?? "";
  const [tab, setTab] = useState<"attend" | "leave" | "notices">(qs.get("tab") === "leave" ? "leave" : qs.get("tab") === "notices" ? "notices" : "attend");
  const [p, setP] = useState<AttendPage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [res, setRes] = useState<AttendCheckResult | null>(null);
  const load = useCallback(() => {
    if (!token) { setErr("الرابط ناقص. اطلب رابطك من الموارد البشرية أو اكتب «حضور» لبوت المنشأة."); return; }
    api.attendPage(token).then(setP).catch((e: Error) => setErr(e.message));
  }, [token]);
  useEffect(load, [load]);

  async function enroll() {
    if (!p) return;
    setBusy("enroll"); setErr(null);
    try {
      const w = p.webauthn;
      const r = await registerDevice({ rp_id: w.rp_id, rp_name: w.rp_name, challenge: w.challenge, user_id: w.user_id, user_name: p.employee_name });
      await api.attendEnroll(token, { challenge: w.challenge, ...r, label: deviceLabel() });
      load();
    } catch (e) { setErr(e instanceof Error ? e.message : "تعذّر ربط الجهاز"); load(); }
    finally { setBusy(null); }
  }

  async function check(kind: "IN" | "OUT") {
    if (!p) return;
    setBusy(kind); setErr(null); setRes(null);
    try {
      const pos = await getPosition();
      const w = p.webauthn;
      // نسخة العرض: الأجهزة المزروعة مسبقاً وهمية، فيُستعاض عن البصمة بتوقيع شكلي
      const demoDev = process.env.NEXT_PUBLIC_DEMO === "1" && w.credential_id === "demo-credential";
      const sig = !p.has_device || !w.credential_id ? null
        : demoDev ? { credential_id: w.credential_id, client_data_json: "demo", authenticator_data: "demo", signature: "demo" }
        : await signWithDevice({ rp_id: w.rp_id, challenge: w.challenge, credential_id: w.credential_id });
      const r = await api.attendCheck(token, {
        kind, lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy,
        ...(sig ? { challenge: w.challenge, ...sig } : {}),
      });
      setRes(r);
    } catch (e) { setErr(e instanceof Error ? e.message : "تعذّر التسجيل"); }
    finally { setBusy(null); load(); }
  }

  const needEnroll = p && !p.has_device;
  const lastIn = p?.today.filter((t) => t.status === "ACCEPTED" && t.kind === "IN").at(-1);
  const lastOut = p?.today.filter((t) => t.status === "ACCEPTED" && t.kind === "OUT").at(-1);
  return (
    <main className="login attend">
      <div className="login-brand"><Logo variant="full" tone="light" /></div>
      <div className="login-form">
        {!p && !err && <p aria-busy="true">جارٍ التحميل…</p>}
        {!p && err && <><h1>تعذّر فتح الرابط</h1><p className="error">{err}</p></>}
        {p && <>
          <h1 style={{ marginBottom: 0 }}>أهلاً {p.employee_name.split(" ")[0]}</h1>
          <p className="muted" style={{ marginTop: 4 }}>{p.org_name}</p>
          <div className="filters" role="tablist">
            {([["attend", "الحضور"], ["leave", "إجازاتي"], ["notices", "إشعاراتي"]] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>))}
          </div>
          {tab === "leave" && <LeavesPanel token={token} />}
          {tab === "notices" && <NoticesPanel token={token} />}
          {tab === "attend" && <>
          {!webauthnSupported() && (p.require_device || p.has_device) && <p className="error">متصفحك لا يدعم التحقق بالبصمة. افتح الرابط في Safari على آيفون أو Chrome على أندرويد.</p>}

          {needEnroll ? (
            <section className="panel inline-form">
              <h2>ربط جوالك (مرة واحدة)</h2>
              <p className="small">سيطلب جوالك بصمتك أو وجهك لربطه بسجلك. بعدها لا يقبل حصيف تسجيلك إلا من هذا الجوال وبعد التحقق.</p>
              <p className="small muted">بصمتك لا تُرسل إلى حصيف ولا للمنشأة؛ تبقى داخل جوالك، ونحفظ مفتاحاً رقمياً عاماً فقط.</p>
              <button className="btn btn-action" type="button" disabled={!!busy || !webauthnSupported()} onClick={enroll}>{busy === "enroll" ? "بانتظار البصمة…" : "اربط جوالي بالبصمة"}</button>
              {!p.require_device && <button className="link-btn" type="button" disabled={!!busy} onClick={() => check(lastIn && !lastOut ? "OUT" : "IN")}>تسجيل دون ربط (تسمح به منشأتك)</button>}
            </section>
          ) : (
            <section style={{ display: "grid", gap: 10 }}>
              <button className="btn btn-action attend-btn" type="button" disabled={!!busy} onClick={() => check("IN")}>{busy === "IN" ? "جارٍ التحقق…" : "تسجيل حضور"}</button>
              <button className="btn attend-btn" type="button" disabled={!!busy} onClick={() => check("OUT")}>{busy === "OUT" ? "جارٍ التحقق…" : "تسجيل انصراف"}</button>
              <p className="small muted">يُلتقط موقعك لحظة الضغط فقط ثم يُطلب التحقق ببصمة جوالك.{p.sites.length ? ` المواقع المعتمدة: ${p.sites.join("، ")}.` : ""}</p>
            </section>
          )}

          {res && (res.status === "ACCEPTED"
            ? <p className="notice" role="status">✓ سُجّل {res.kind === "IN" ? "حضورك" : "انصرافك"} الساعة {fmtTime(res.at)}{res.site_name ? ` في ${res.site_name}` : ""}.
                {(res.late_minutes ?? 0) > 0 && ` تأخرت ${res.late_minutes} دقيقة.`}</p>
            : <p className="error" role="alert">لم يُقبل التسجيل: {res.reason_label ?? res.reason}{res.distance_m != null && res.reason === "OUTSIDE" ? ` (تبعد ${Math.round(res.distance_m)} م عن أقرب موقع)` : ""}.</p>)}
          {err && <p className="error" role="alert">{err}</p>}

          {p.today.length > 0 && (
            <section>
              <h2 style={{ fontSize: "var(--t-md)" }}>اليوم</h2>
              <ul className="labor-rules">{p.today.map((t, i) => (
                <li key={i}>{t.kind === "IN" ? "حضور" : "انصراف"} {fmtTime(t.at)} — {t.status === "ACCEPTED" ? "مقبول" : `مرفوض (${t.reason_label ?? t.reason})`}
                  {(t.late_minutes ?? 0) > 0 && ` · تأخر ${t.late_minutes} د`}</li>))}</ul>
            </section>
          )}
          </>}
          <p className="small muted" style={{ borderTop: "1px solid var(--line, #e5e7eb)", paddingTop: 10 }}>
            تعالج منشأتك موقعك لغرض إثبات الحضور فقط، وتُحذف الإحداثيات تلقائياً بعد مدة محددة، وفق نظام حماية البيانات الشخصية. لا تشارك هذا الرابط مع أحد.</p>
        </>}
      </div>
    </main>
  );
}

const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());

function usePersonHr(token: string) {
  const [d, setD] = useState<PersonHr | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { api.personHr(token).then(setD).catch((e: Error) => setErr(e.message)); }, [token]);
  useEffect(load, [load]);
  return { d, err, load };
}

function LeavesPanel({ token }: { token: string }) {
  const { d, err, load } = usePersonHr(token);
  const [form, setForm] = useState(false);
  const [v, setV] = useState({ leave_type: "ANNUAL" as LeaveType, start_date: todayIso(), end_date: todayIso(), reason: "", medical_ref: "" });
  const [att, setAtt] = useState<LeaveAttachment | null>(null);
  const [paid, setPaid] = useState(true);
  const [attFor, setAttFor] = useState<string | null>(null);   // إرفاق لاحق لطلب قائم
  const [late, setLate] = useState<LeaveAttachment | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [e2, setE2] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run<T>(fn: () => Promise<T>, ok: string | ((r: T) => string)) {
    setBusy(true); setMsg(null); setE2(null);
    try { const r = await fn(); setMsg(typeof ok === "function" ? ok(r) : ok); load(); return true; }
    catch (x) { setE2(x instanceof Error ? x.message : "تعذّر"); return false; } finally { setBusy(false); }
  }
  if (!d) return err ? <p className="error">{err}</p> : <p aria-busy="true">جارٍ التحميل…</p>;
  const pol = d.policies.find((x) => x.leave_type === v.leave_type);
  const today = todayIso();
  return (
    <section style={{ display: "grid", gap: 12 }}>
      <div className="panel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div><div className="small muted">رصيد إجازتك السنوية {d.balance.year}</div><b style={{ fontSize: "var(--t-xl)" }}>{fmtDays(d.balance.balance)} يوم</b></div>
        <div className="small muted" style={{ textAlign: "end" }}>الاستحقاق {d.balance.entitlement}<br />المستخدم {d.balance.used}</div>
      </div>
      {msg && <p className="notice" role="status">{msg}</p>}
      {e2 && <p className="error" role="alert">{e2}</p>}
      {!form ? <button className="btn btn-action attend-btn" type="button" onClick={() => setForm(true)}>طلب إجازة</button> : (
        <form className="panel inline-form" onSubmit={async (e) => { e.preventDefault();
          if (v.leave_type === "SICK" && !att) { setE2("أرفق التقرير الطبي: صوّره بالجوال أو اختر ملف PDF."); return; }
          if (await run(() => api.personLeave(token, { ...v, reason: v.reason || null, medical_ref: v.medical_ref || null,
            attachment: v.leave_type === "SICK" ? att : null, is_paid: pol?.pay_mode === "CHOICE" ? paid : null }),
            (r) => `أُرسل طلبك (${r.days} يوم) إلى الموارد البشرية.${r.pay_note ? ` ${r.pay_note}.` : ""}`)) { setForm(false); setAtt(null); } }}>
          <div className="field"><label htmlFor="pt">نوع الإجازة</label>
            <select id="pt" value={v.leave_type} onChange={(e) => setV({ ...v, leave_type: e.target.value as LeaveType })}>
              {d.policies.map((x) => <option key={x.leave_type} value={x.leave_type}>{x.label}</option>)}</select></div>
          {pol && <p className="small muted">
            {pol.pay_mode === "CHOICE" ? "تختار: مدفوعة أو بدون أجر" : pol.pay_mode === "UNPAID" ? "بدون أجر" : pol.leave_type === "SICK" ? "بأجر حسب شرائح نظام العمل" : "مدفوعة"}
            {pol.from_balance && pol.pay_mode !== "UNPAID" ? `، ${pol.pay_mode === "CHOICE" ? "المدفوعة " : ""}تُخصم من رصيدك السنوي` : ""}
            {pol.max_days_per_request ? `، حتى ${pol.max_days_per_request} يوم للطلب` : ""}{pol.yearly_cap ? `، والمتبقي هذا العام ${Math.max(pol.yearly_cap - pol.used, 0)} يوم` : ""}
            {pol.leave_type === "EMERGENCY" ? "، وتُرفع خلال 3 أيام من بدايتها" : pol.leave_type === "SICK" ? "، وتُرفع خلال 7 أيام من بدايتها مع إرفاق التقرير الطبي" : ""}.
          </p>}
          {pol?.pay_mode === "CHOICE" && (
            <fieldset className="field pay-choice"><legend>الأجر</legend>
              <label className="checks-inline"><input type="radio" name="paid" checked={paid} onChange={() => setPaid(true)} />
                مدفوعة{pol.from_balance ? ` (تُخصم من رصيدك: ${fmtDays(d.balance.balance)} يوم)` : ""}</label>
              <label className="checks-inline"><input type="radio" name="paid" checked={!paid} onChange={() => setPaid(false)} /> بدون أجر (لا تمس رصيدك، ويُحسم أجر أيامها)</label>
            </fieldset>)}
          <div className="grid">
            <div className="field"><label htmlFor="ps">من</label><input id="ps" type="date" required value={v.start_date} onChange={(e) => setV({ ...v, start_date: e.target.value, end_date: e.target.value > v.end_date ? e.target.value : v.end_date })} /></div>
            <div className="field"><label htmlFor="pe">إلى</label><input id="pe" type="date" required min={v.start_date} value={v.end_date} onChange={(e) => setV({ ...v, end_date: e.target.value })} /></div>
          </div>
          {v.leave_type === "SICK" && <>
            <AttachPicker value={att} onChange={setAtt} required />
            <div className="field"><label htmlFor="pm">رقم التقرير في منصة صحة (اختياري)</label><input id="pm" maxLength={60} value={v.medical_ref} onChange={(e) => setV({ ...v, medical_ref: e.target.value })} /></div>
            <p className="small muted">التقرير بيانات صحية: لا يطّلع عليه إلا مدير المنشأة ومسؤول الامتثال، ويُسجَّل كل اطلاع.</p>
          </>}
          <div className="field"><label htmlFor="pr">ملاحظة (اختياري)</label><input id="pr" maxLength={500} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></div>
          <div style={{ display: "flex", gap: 8 }}><button className="btn btn-action" type="submit" disabled={busy}>إرسال الطلب</button>
            <button className="btn btn-quiet" type="button" onClick={() => setForm(false)}>إلغاء</button></div>
        </form>
      )}
      <h2 style={{ fontSize: "var(--t-md)", margin: 0 }}>طلباتي</h2>
      {d.leaves.length === 0 && <p className="small muted">لا طلبات بعد.</p>}
      {d.leaves.map((l) => {
        const canReturn = l.status === "APPROVED" && !l.return_confirmed_at && l.end_date < today;
        return (
          <div key={l.id} className="panel" style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b>إجازة {l.label} · {l.days} يوم{l.is_paid === false ? " · بدون أجر" : ""}</b>
              <span className="status-chip" data-s={l.status === "APPROVED" ? "IN_PLACE" : l.status === "PENDING" ? "PENDING" : "EXPIRED"}>{LEAVE_STATUS[l.status]}</span></div>
            <div className="small muted">{formatDate(l.start_date)} ← {formatDate(l.end_date)}{l.pay_note ? ` · ${l.pay_note}` : ""}</div>
            {l.has_attachment && <div className="small">📎 التقرير مرفق{l.attachment_name ? `: ${l.attachment_name}` : ""}</div>}
            {l.status === "PENDING" && l.leave_type === "SICK" && (attFor === l.id ? (
              <div style={{ display: "grid", gap: 6 }}>
                <AttachPicker value={late} onChange={setLate} required label={l.has_attachment ? "استبدال التقرير" : "إرفاق التقرير"} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-action btn-xs" type="button" disabled={busy || !late}
                    onClick={async () => { if (late && await run(() => api.personAttach(token, l.id, late), "أُرفق التقرير")) { setAttFor(null); setLate(null); } }}>رفع</button>
                  <button className="btn btn-quiet btn-xs" type="button" onClick={() => { setAttFor(null); setLate(null); }}>إلغاء</button>
                </div>
              </div>) : (
              <button className="link-btn" type="button" onClick={() => { setAttFor(l.id); setLate(null); }}>{l.has_attachment ? "استبدال التقرير" : "إرفاق التقرير الطبي"}</button>))}
            {l.decision_note && <div className="small">ملاحظة الموارد البشرية: {l.decision_note}</div>}
            {l.return_confirmed_at && l.return_date && <div className="small">✓ باشرت {formatDate(l.return_date)}</div>}
            {canReturn && l.return_submitted_at && <div className="small">أبلغت بالمباشرة {formatDate(l.return_date!)} — بانتظار تأكيد الموارد البشرية</div>}
            {canReturn && !l.return_submitted_at && <button className="btn btn-action" type="button" disabled={busy}
              onClick={() => run(() => api.personReturn(token, l.id, today), (r) => r.late_days ? `سُجّلت مباشرتك. تأخرت ${r.late_days} يوم عمل بعد نهاية الإجازة.` : "سُجّلت مباشرتك، حمداً لله على السلامة.")}>
              سجّل مباشرتي اليوم</button>}
            {l.status === "PENDING" && <button className="link-btn" type="button" disabled={busy} onClick={() => run(() => api.personCancelLeave(token, l.id), "أُلغي الطلب")}>إلغاء الطلب</button>}
          </div>
        );
      })}
    </section>
  );
}

function NoticesPanel({ token }: { token: string }) {
  const { d, err, load } = usePersonHr(token);
  const [obj, setObj] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [e2, setE2] = useState<string | null>(null);
  if (!d) return err ? <p className="error">{err}</p> : <p aria-busy="true">جارٍ التحميل…</p>;
  return (
    <section style={{ display: "grid", gap: 12 }}>
      <p className="small muted">يُبلغك صاحب العمل كتابةً بأي خصم وسببه، ولك أن تعترض خلال {d.objection_days} يوماً قبل تأكيده.</p>
      {msg && <p className="notice" role="status">{msg}</p>}
      {e2 && <p className="error" role="alert">{e2}</p>}
      {d.notices.length === 0 && <p className="small muted">لا توجد إشعارات.</p>}
      {d.notices.map((n) => (
        <div key={n.id} className="panel" style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b>{n.nature === "WARNING" ? "إنذار كتابي" : n.nature === "WAGE" ? "حسم أجر المدة" : "جزاء"} — {KIND_LABEL[n.kind]}{n.nature !== "WARNING" ? ` · ${sar(n.amount)}` : ""}</b>
            <span className="status-chip" data-s={n.status === "CONFIRMED" ? "FAIL" : n.status === "CANCELLED" ? "IN_PLACE" : "PENDING"}>{NOTICE_STATUS[n.status]}</span></div>
          <div className="small">{n.description}</div>
          <div className="small muted">الواقعة {formatDate(n.incident_date)}{n.nature !== "WARNING" ? ` · يُخصم من رواتب ${n.payroll_month.slice(0, 7)}` : ""}</div>
          {n.objection_text && <div className="small">اعتراضك: «{n.objection_text}»</div>}
          {n.decision_note && <div className="small">رد الموارد البشرية: {n.decision_note}</div>}
          {n.status === "ISSUED" && (obj === n.id ? (
            <form style={{ display: "grid", gap: 6 }} onSubmit={async (e) => { e.preventDefault(); setMsg(null); setE2(null);
              try { await api.personObject(token, n.id, text); setMsg("أُرسل اعتراضك إلى الموارد البشرية."); setObj(null); setText(""); load(); }
              catch (x) { setE2(x instanceof Error ? x.message : "تعذّر"); } }}>
              <textarea rows={3} required minLength={5} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="اكتب سبب اعتراضك وأي إثبات لديك" aria-label="سبب الاعتراض" />
              <div style={{ display: "flex", gap: 8 }}><button className="btn btn-action" type="submit">إرسال الاعتراض</button><button className="btn btn-quiet" type="button" onClick={() => setObj(null)}>إلغاء</button></div>
            </form>) : <button className="btn" type="button" onClick={() => { setObj(n.id); setText(""); }}>اعتراض</button>)}
        </div>
      ))}
    </section>
  );
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "آيفون";
  if (/iPad/.test(ua)) return "آيباد";
  if (/Android/.test(ua)) return "أندرويد";
  if (/Mac/.test(ua)) return "ماك";
  if (/Windows/.test(ua)) return "ويندوز";
  return "جهاز";
}

export default function AttendRoute() {
  return <Suspense fallback={null}><Attend /></Suspense>;
}
