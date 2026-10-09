"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PLAN_LABEL, formatDate, round2, sar, type CheckoutOptions } from "@haseef/shared";
import { api } from "@/lib/session";

/** الدفع الإلكتروني: القسط المستحق، أو الاشتراك/التجديد، أو إضافة بوت الموظفين. */
export function PayPanel() {
  const router = useRouter();
  const [o, setO] = useState<CheckoutOptions | null>(null);
  const [tier, setTier] = useState("PROFESSIONAL_GRC");
  const [cycle, setCycle] = useState<"MONTHLY" | "YEARLY">("YEARLY");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.checkoutOptions().then((x) => { setO(x); if (x.subscription) setTier(x.subscription.plan_tier); }).catch((e: Error) => setError(e.message));
  }, []);
  if (!o) return error ? <p className="error">{error}</p> : null;
  const vat = 1 + o.vat_rate;
  const plan = o.plans.find((p) => p.tier === tier);
  const price = plan ? (cycle === "YEARLY" ? plan.yearly_price_sar : plan.monthly_price_sar) : 0;
  const bot = o.addons.find((a) => a.code === "WA_BOT");

  async function go(key: string, b: Parameters<typeof api.checkout>[0]) {
    setBusy(key); setError(null);
    try {
      const r = await api.checkout(b);
      if (r.checkout_url.startsWith("/")) router.push(r.checkout_url);
      else window.location.href = r.checkout_url;
    } catch (e) { setError(e instanceof Error ? e.message : "تعذّر بدء الدفع"); setBusy(null); }
  }

  return (
    <section>
      <h2>الدفع الإلكتروني</h2>
      <p className="muted small">مدى وفيزا وماستركارد وApple Pay عبر بوابة دفع سعودية مرخصة. تصدر الفاتورة الضريبية تلقائياً بعد نجاح الدفع.
        {o.provider === "fake" && " (نسخة تجريبية: الدفع محاكاة ولا تُخصم أي مبالغ.)"}</p>
      {!o.can_pay && <p className="hint-box">الدفع متاح لمدير المنشأة ومسؤول الامتثال.</p>}
      <div className="pay-grid">
        {o.next_installment ? (
          <div className="panel pay-card">
            <h3>القسط {o.next_installment.seq} من {o.next_installment.installments}</h3>
            <p className="price">{sar(round2(o.next_installment.amount_net * vat))} <small>شامل الضريبة</small></p>
            <p className="small muted">يستحق {formatDate(o.next_installment.due_date)}</p>
            <button className="btn btn-action" type="button" disabled={!o.can_pay || !!busy}
              onClick={() => go("inst", { purpose: "INSTALLMENT", installment_id: o.next_installment!.id })}>{busy === "inst" ? "جارٍ التحويل…" : "ادفع القسط"}</button>
          </div>
        ) : (
          <div className="panel pay-card">
            <h3>{o.subscription?.billing_status === "TRIAL" ? "ابدأ اشتراكك" : o.subscription ? "جدّد أو غيّر باقتك" : "اشترك الآن"}</h3>
            <div className="field"><label htmlFor="pt">الباقة</label>
              <select id="pt" value={tier} onChange={(e) => setTier(e.target.value)}>
                {o.plans.map((p) => <option key={p.tier} value={p.tier}>{PLAN_LABEL[p.tier] ?? p.name_ar}</option>)}</select></div>
            <div className="filters" role="radiogroup" aria-label="الدورية">
              {(["YEARLY", "MONTHLY"] as const).map((c) => (
                <button key={c} type="button" aria-pressed={cycle === c} onClick={() => setCycle(c)}>{c === "YEARLY" ? "سنوي (شهران مجاناً)" : "شهري"}</button>))}
            </div>
            <p className="price">{sar(round2(price * vat))} <small>{cycle === "YEARLY" ? "للسنة" : "للشهر"} شامل الضريبة</small></p>
            {o.subscription && o.subscription.billing_status !== "TRIAL" && <p className="small muted">يمتد اشتراكك من نهايته الحالية {formatDate(o.subscription.ends_at.slice(0, 10))}.</p>}
            <button className="btn btn-action" type="button" disabled={!o.can_pay || !!busy}
              onClick={() => go("sub", { purpose: "SUBSCRIPTION", plan_tier: tier, billing_cycle: cycle })}>{busy === "sub" ? "جارٍ التحويل…" : "ادفع الآن"}</button>
          </div>
        )}
        {bot && bot.is_active && (
          <div className="panel pay-card">
            <h3>{bot.name}</h3>
            {o.bot.via === "PLAN" ? <p className="small">مشمول في باقتك مجاناً.</p> : (
              <>
                <p className="price">{sar(round2(bot.monthly_price * vat))} <small>شهرياً شامل الضريبة</small></p>
                <p className="small muted">{o.bot.via === "ADDON" && o.bot.paid_until ? `مفعّل حتى ${formatDate(o.bot.paid_until.slice(0, 10))}.` : "مساعد واتساب يجيب موظفيك من سياسات منشأتك."}
                  {" "}حتى {bot.limits.members ?? "∞"} موظفاً و{bot.limits.questions ?? "∞"} سؤال شهرياً.</p>
                <button className="btn" type="button" disabled={!o.can_pay || !!busy}
                  onClick={() => go("bot", { purpose: "ADDON", addon_code: "WA_BOT" })}>{busy === "bot" ? "جارٍ التحويل…" : o.bot.via ? "مدّد شهراً" : "اشترك في البوت"}</button>
              </>
            )}
          </div>
        )}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
