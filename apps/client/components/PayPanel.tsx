"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PLAN_LABEL, formatDate, round2, sar, type CheckoutOptions } from "@haseef/shared";
import { api } from "@/lib/session";

const accessOf = (o: CheckoutOptions, code: string) => o.addon_access?.[code] ?? (code === "WA_BOT" ? o.bot : code === "ATTENDANCE" ? o.attendance : undefined);
const HR = "حضور بالموقع وبصمة الجوال، وطلبات الإجازة والمباشرة، وإشعارات الخصم للموظفين.";
const ADDON_BLURB: Record<string, string> = {
  WA_BOT: "مساعد واتساب يجيب موظفيك من سياسات منشأتك.",
  ATTENDANCE: HR,
  ATTENDANCE_75: HR,
  ATTENDANCE_200: HR,
  STAFF_BUNDLE: "الموارد البشرية وبوت الواتساب معاً بسعر أقل.",
};

/** الدفع الإلكتروني: القسط المستحق، أو الاشتراك/التجديد، أو الإضافات (بوت الموظفين، الحضور بالموقع). */
export function PayPanel() {
  const router = useRouter();
  const [o, setO] = useState<CheckoutOptions | null>(null);
  const [tier, setTier] = useState("PROFESSIONAL_GRC");
  const [cycle, setCycle] = useState<"MONTHLY" | "YEARLY">("YEARLY");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promoMsg, setPromoMsg] = useState<string | null>(null);
  const loadOptions = () => api.checkoutOptions().then((x) => { setO(x); if (x.subscription) setTier(x.subscription.plan_tier); }).catch((e: Error) => setError(e.message));
  useEffect(() => { loadOptions(); }, []);
  async function claim(code: string) {
    setBusy("promo"); setError(null);
    try { const r = await api.claimPromo(code); setPromoMsg(`فُعّلت «${r.addon_name}» مجاناً حتى ${formatDate(r.paid_until.slice(0, 10))}.`); await loadOptions(); }
    catch (e) { setError(e instanceof Error ? e.message : "تعذّر تفعيل العرض"); } finally { setBusy(null); }
  }
  if (!o) return error ? <p className="error">{error}</p> : null;
  const vat = 1 + o.vat_rate;
  const plan = o.plans.find((p) => p.tier === tier);
  const price = plan ? (cycle === "YEARLY" ? plan.yearly_price_sar : plan.monthly_price_sar) : 0;

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
      {promoMsg && <p className="notice" role="status">{promoMsg}</p>}
      {o.promo?.active && o.promo.eligible && (
        <div className="panel promo-card">
          <div><b>🎁 {o.promo.name}</b>
            <p className="small muted" style={{ margin: "4px 0 0" }}>يُفعَّل لك «{o.promo.tier_name}» مجاناً لمدة {o.promo.free_months === 1 ? "شهر" : `${o.promo.free_months} أشهر`} حسب عدد موظفيك ({o.employees}).
              بعدها تختار الاشتراك أو تتوقف بلا التزام. المتبقي {o.promo.remaining} من {o.promo.max ?? 50}.</p></div>
          <button className="btn btn-action" type="button" disabled={!o.can_pay || !!busy} onClick={() => claim(o.promo!.code)}>{busy === "promo" ? "جارٍ التفعيل…" : "فعّل الشهر المجاني"}</button>
        </div>
      )}
      {o.hr_tier === null && (o.employees ?? 0) > 0 && (
        <p className="hint-box">عندك {o.employees} موظفاً، أكثر من أكبر شريحة للموارد البشرية (200). باقة كبار العملاء تشمل الموارد البشرية وبوت الموظفين بلا حد للموظفين.</p>
      )}
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
        {o.addons.filter((a) => a.is_active).map((ad) => {
          const acc = accessOf(o, ad.code);
          if (!acc) return null;
          const k = `addon-${ad.code}`;
          const via = acc.granted_by && acc.granted_by !== ad.code ? o.addons.find((x) => x.code === acc.granted_by) : null;
          const emp = o.employees ?? 0;
          const fits = ad.limits.members == null || emp <= ad.limits.members;
          const best = !!o.hr_tier && ad.code === o.hr_tier;
          return (
            <div key={ad.code} className={`panel pay-card${best && !acc.via ? " pay-best" : ""}`}>
              <h3>{ad.name}</h3>
              {best && !acc.via && <span className="tag">مناسب لعدد موظفيك ({emp})</span>}
              {acc.via === "PLAN" ? <p className="small">مشمول في باقتك مجاناً.</p> : via ? <p className="small">مشمول في «{via.name}» حتى {formatDate(acc.paid_until!.slice(0, 10))}.</p> : (
                <>
                  <p className="price">{sar(round2(ad.monthly_price * vat))} <small>شهرياً شامل الضريبة</small></p>
                  <p className="small muted">{acc.via === "ADDON" && acc.paid_until ? `مفعّل حتى ${formatDate(acc.paid_until.slice(0, 10))}.` : ADDON_BLURB[ad.code]}
                    {" "}{ad.limits.questions ? `حتى ${ad.limits.members ?? "∞"} موظفاً و${ad.limits.questions} سؤال شهرياً.` : ad.limits.members ? `حتى ${ad.limits.members} موظفاً.` : ""}
                    {!fits && ad.code.startsWith("ATTENDANCE") && ` عندك ${emp} موظفاً، فالشريحة الأكبر أنسب.`}</p>
                  <button className="btn" type="button" disabled={!o.can_pay || !!busy}
                    onClick={() => go(k, { purpose: "ADDON", addon_code: ad.code })}>{busy === k ? "جارٍ التحويل…" : acc.via ? "مدّد شهراً" : "اشترك"}</button>
                </>
              )}
            </div>
          );
        })}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
