"use client";

import { useEffect, useState } from "react";
import { type OnboardingInput, type OnboardingState } from "@haseef/shared";
import { api } from "@/lib/session";

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const STEPS = ["المنشأة", "العمل والرواتب", "الزكاة والضريبة", "التنبيهات"];

export default function OnboardingPage() {
  const [st, setSt] = useState<OnboardingState | null>(null);
  const [step, setStep] = useState(0);
  const [v, setV] = useState<OnboardingInput>({ commercial_size: "SMALL", industry_type: null, employees_count: 5, labor_enabled: true, salary_day: 27,
    vat_registered: false, vat_frequency: "QUARTERLY", withholding_applies: false, fiscal_year_end_month: 12, alert_phone: null });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.onboarding().then((s) => { setSt(s); if (s.phone_number) setV((x) => ({ ...x, alert_phone: s.phone_number })); }).catch((e: Error) => setError(e.message)); }, []);
  const set = <K extends keyof OnboardingInput>(k: K, val: OnboardingInput[K]) => setV({ ...v, [k]: val });

  async function finish() {
    setBusy(true); setError(null);
    try { await api.completeOnboarding(v); window.location.href = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`; }
    catch (e) { setError(e instanceof Error ? e.message : "تعذّر الحفظ"); setBusy(false); }
  }
  if (!st) return error ? <p className="error">{error}</p> : <div className="boot" aria-busy="true" />;
  if (!st.needs_onboarding) return <p className="muted">منشأتك جاهزة. <a href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`}>إلى الرادار العام</a></p>;

  return (
    <section className="panel inline-form" style={{ maxWidth: 720 }}>
      <header>
        <h1>أهلاً بك في حصيف</h1>
        <p className="muted">أربع خطوات قصيرة نجهّز بها التزامات «{st.name}» وتقويمها وتنبيهاتها. يمكنك تعديل كل شيء لاحقاً.</p>
      </header>
      <ol className="steps-bar">{STEPS.map((s, i) => <li key={s} data-on={i === step || undefined}>{i + 1}. {s}</li>)}</ol>

      {step === 0 && (
        <div className="grid">
          <div className="field"><label>حجم المنشأة</label>
            <select value={v.commercial_size} onChange={(e) => set("commercial_size", e.target.value as OnboardingInput["commercial_size"])}>
              <option value="MICRO">متناهية الصغر (1–5)</option><option value="SMALL">صغيرة (6–49)</option><option value="MEDIUM">متوسطة (50–249)</option></select></div>
          <div className="field"><label>النشاط</label><input placeholder="مثال: مقاولات، تجزئة، تقنية" value={v.industry_type ?? ""} onChange={(e) => set("industry_type", e.target.value || null)} /></div>
          <div className="field"><label>عدد الموظفين تقريباً</label><input type="number" min={0} value={v.employees_count} onChange={(e) => set("employees_count", Number(e.target.value))} /></div>
        </div>
      )}
      {step === 1 && (
        <div className="grid">
          <label className="checks-inline field-wide"><input type="checkbox" checked={v.labor_enabled} onChange={(e) => set("labor_enabled", e.target.checked)} />
            فعّل تقويم الرواتب وسداد التأمينات ورفع ملف حماية الأجور مع التنبيهات</label>
          {v.labor_enabled && <div className="field"><label>يوم صرف الرواتب</label><input type="number" min={1} max={28} value={v.salary_day} onChange={(e) => set("salary_day", Number(e.target.value))} /></div>}
        </div>
      )}
      {step === 2 && (
        <div className="grid">
          <label className="checks-inline field-wide"><input type="checkbox" checked={v.vat_registered} onChange={(e) => set("vat_registered", e.target.checked)} /> المنشأة مسجلة في ضريبة القيمة المضافة</label>
          {v.vat_registered && <div className="field"><label>دورية الإقرار</label>
            <select value={v.vat_frequency} onChange={(e) => set("vat_frequency", e.target.value as OnboardingInput["vat_frequency"])}>
              <option value="QUARTERLY">ربع سنوية (التوريدات حتى 40 مليون ريال)</option><option value="MONTHLY">شهرية (أكثر من 40 مليون ريال)</option></select></div>}
          <div className="field"><label>نهاية السنة المالية</label>
            <select value={v.fiscal_year_end_month} onChange={(e) => set("fiscal_year_end_month", Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></div>
          <label className="checks-inline field-wide"><input type="checkbox" checked={v.withholding_applies} onChange={(e) => set("withholding_applies", e.target.checked)} /> ندفع لجهات غير مقيمة (ضريبة الاستقطاع)</label>
        </div>
      )}
      {step === 3 && (
        <div className="grid">
          <div className="field field-wide"><label>جوالك لتنبيهات واتساب</label>
            <input dir="ltr" placeholder="+9665XXXXXXXX" pattern="\+9665\d{8}" value={v.alert_phone ?? ""} onChange={(e) => set("alert_phone", e.target.value.trim() || null)} /></div>
          <p className="small muted field-wide">تصلك التنبيهات قبل انتهاء التراخيص ومواعيد التأمينات والإقرارات. تضيف زملاءك وتغيّر القنوات من صفحة «التنبيهات».</p>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        {step > 0 && <button className="btn btn-quiet" type="button" onClick={() => setStep(step - 1)}>السابق</button>}
        {step < STEPS.length - 1
          ? <button className="btn btn-action" type="button" onClick={() => setStep(step + 1)}>التالي</button>
          : <button className="btn btn-action" type="button" disabled={busy} onClick={finish}>{busy ? "جارٍ التجهيز…" : "جهّز منشأتي"}</button>}
      </div>
    </section>
  );
}
