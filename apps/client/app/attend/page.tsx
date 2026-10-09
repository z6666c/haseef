"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { registerDevice, signWithDevice, webauthnSupported, type AttendCheckResult, type AttendPage } from "@haseef/shared";
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
  const token = useSearchParams().get("t") ?? "";
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
          <p className="muted" style={{ marginTop: 4 }}>تسجيل الحضور والانصراف — {p.org_name}</p>
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
          <p className="small muted" style={{ borderTop: "1px solid var(--line, #e5e7eb)", paddingTop: 10 }}>
            تعالج منشأتك موقعك لغرض إثبات الحضور فقط، وتُحذف الإحداثيات تلقائياً بعد مدة محددة، وفق نظام حماية البيانات الشخصية. لا تشارك هذا الرابط مع أحد.</p>
        </>}
      </div>
    </main>
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
