"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LEGAL_TYPE_LABEL, type PlanPrice, type SignupInput } from "@haseef/shared";
import { LegalFooter } from "@/components/LegalDoc";
import { Logo } from "@/components/Logo";
import { api, setSession } from "@/lib/session";

const EMPTY: SignupInput = { company_name: "", cr_number: "", entity_legal_type: "LLC", full_name: "", email: "", phone_number: null,
  password: "", plan_tier: "PROFESSIONAL_GRC", consent: false, website: "" };

export default function SignupPage() {
  const router = useRouter();
  const [v, setV] = useState<SignupInput>(EMPTY);
  const [pw2, setPw2] = useState("");
  const [plans, setPlans] = useState<PlanPrice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.publicPricing().then((p) => setPlans(p.plans)).catch(() => {}); }, []);
  const set = <K extends keyof SignupInput>(k: K, val: SignupInput[K]) => setV({ ...v, [k]: val });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (v.password !== pw2) { setError("كلمتا المرور غير متطابقتين"); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.signup({ ...v, phone_number: v.phone_number || null });
      setSession({ token: r.access_token, orgId: r.org_id });
      router.replace("/onboarding");
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر التسجيل");
    } finally { setBusy(false); }
  }

  return (
    <main className="login">
      <div className="login-brand">
        <Logo variant="full" tone="light" />
        <p className="login-tagline">جرّب حصيف مجاناً 14 يوماً، بلا بطاقة دفع. التراخيص والحوكمة وحماية البيانات والتأمينات والزكاة في مكان واحد.</p>
      </div>
      <form className="login-form auth-wide" onSubmit={submit}>
        <h1>افتح حساب منشأتك</h1>
        <fieldset className="plan-pick" aria-label="الباقة">
          {plans.map((p) => (
            <label key={p.tier}>
              <input type="radio" name="plan" value={p.tier} checked={v.plan_tier === p.tier} onChange={() => set("plan_tier", p.tier)} />
              <b>{p.name_ar}</b>
              <small>{p.monthly_price_sar.toLocaleString("en-US")} ريال شهرياً بعد التجربة</small>
            </label>
          ))}
        </fieldset>
        <div className="grid">
          <div className="field"><label htmlFor="cn">اسم المنشأة</label><input id="cn" required minLength={2} value={v.company_name} onChange={(e) => set("company_name", e.target.value)} /></div>
          <div className="field"><label htmlFor="cr">السجل التجاري (10 أرقام)</label><input id="cr" dir="ltr" required inputMode="numeric" pattern="\d{10}" value={v.cr_number} onChange={(e) => set("cr_number", e.target.value.replace(/\D/g, "").slice(0, 10))} /></div>
          <div className="field"><label htmlFor="lt">نوع الكيان</label>
            <select id="lt" value={v.entity_legal_type} onChange={(e) => set("entity_legal_type", e.target.value)}>
              {Object.entries(LEGAL_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="field"><label htmlFor="fn">اسمك</label><input id="fn" required minLength={2} value={v.full_name} onChange={(e) => set("full_name", e.target.value)} /></div>
          <div className="field"><label htmlFor="em">البريد الإلكتروني</label><input id="em" type="email" dir="ltr" required autoComplete="username" value={v.email} onChange={(e) => set("email", e.target.value)} /></div>
          <div className="field"><label htmlFor="ph">الجوال لتنبيهات واتساب (اختياري)</label><input id="ph" dir="ltr" placeholder="+9665XXXXXXXX" pattern="\+9665\d{8}" value={v.phone_number ?? ""} onChange={(e) => set("phone_number", e.target.value.trim() || null)} /></div>
          <div className="field"><label htmlFor="pw">كلمة المرور (10 أحرف على الأقل)</label><input id="pw" type="password" dir="ltr" required minLength={10} autoComplete="new-password" value={v.password} onChange={(e) => set("password", e.target.value)} /></div>
          <div className="field"><label htmlFor="pw2">أعد كتابتها</label><input id="pw2" type="password" dir="ltr" required minLength={10} autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
        </div>
        <input className="sr-only" tabIndex={-1} aria-hidden="true" autoComplete="off" value={v.website ?? ""} onChange={(e) => set("website", e.target.value)} />
        <label className="checks-inline"><input type="checkbox" checked={v.consent} onChange={(e) => set("consent", e.target.checked)} required />
          <span>أوافق على <Link href="/terms">شروط الاستخدام</Link> و<Link href="/privacy">سياسة الخصوصية</Link> ومعالجة بيانات منشأتي لتقديم الخدمة.</span></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn-action" type="submit" disabled={busy || !v.consent}>{busy ? "جارٍ إنشاء الحساب…" : "ابدأ التجربة المجانية"}</button>
        <p className="small muted login-legal-note">لديك حساب؟ <Link href="/login">سجّل الدخول</Link></p>
        <LegalFooter withLogin={false} />
      </form>
    </main>
  );
}
