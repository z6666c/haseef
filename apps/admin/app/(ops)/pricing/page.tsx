"use client";

import { useCallback, useEffect, useState } from "react";
import { PLAN_LABEL, sar, type AddonPrice, type HrMix, type PlanPrice, type PromoStatus, type PublicPricing } from "@haseef/shared";
import { useCan } from "@/components/ui";
import { api } from "@/lib/session";

const TIERS = ["ESSENTIAL", "PROFESSIONAL_GRC", "ENTERPRISE"];

export default function PricingPage() {
  const can = useCan();
  const editor = can("billing.manage");
  const [d, setD] = useState<(PublicPricing & { promotions?: PromoStatus[]; hr_mix?: HrMix }) | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { api.admin.pricing().then(setD).catch((e: Error) => setError(e.message)); }, []);
  useEffect(load, [load]);
  async function act(fn: () => Promise<unknown>, ok: string) {
    setError(null); setNotice(null);
    try { await fn(); setNotice(ok); load(); } catch (e) { setError(e instanceof Error ? e.message : "تعذّر الحفظ"); }
  }
  if (!d) return error ? <p className="error">{error}</p> : null;
  return (
    <>
      <h1>التسعير</h1>
      <p className="muted">أسعار الباقات والإضافات كما تظهر في صفحة حصيف والتسجيل والدفع الإلكتروني. التغيير يسري على الدفعات والتسجيلات الجديدة فوراً،
        والاشتراكات القائمة تبقى على ما دُفع حتى تجديدها. الأسعار قبل ضريبة القيمة المضافة.</p>
      {!editor && <p className="hint">التعديل يتطلب صلاحية «الاشتراكات والمدفوعات».</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <h2>الباقات</h2>
      <table className="table">
        <thead><tr><th>الباقة</th><th>شهري</th><th>سنوي</th><th>خصم السنوي</th><th>رسائل واتساب شهرياً</th><th><span className="sr-only">حفظ</span></th></tr></thead>
        <tbody>{d.plans.map((p) => <PlanRow key={p.tier + p.monthly_price_sar + p.yearly_price_sar + p.monthly_whatsapp_alerts} p={p} editor={editor}
          onSave={(v) => act(() => api.admin.setPlanPrice(p.tier, v), `حُفظت أسعار ${PLAN_LABEL[p.tier] ?? p.name_ar}`)} />)}</tbody>
      </table>
      {d.hr_mix && <MixCard m={d.hr_mix} bundle={d.addons.find((a) => a.code === "STAFF_BUNDLE")} />}
      {(d.promotions ?? []).length > 0 && <>
        <h2>العروض</h2>
        {d.promotions!.map((p) => <PromoForm key={p.code + p.used + p.max + String(p.active)} p={p} editor={editor}
          onSave={(v) => act(() => api.admin.setPromo(p.code, v), `حُفظ «${p.name}»`)} />)}
      </>}
      <h2>الإضافات</h2>
      {d.addons.map((a) => <AddonForm key={a.code + JSON.stringify(a)} a={a} editor={editor}
        onSave={(v) => act(() => api.admin.setAddon(a.code, v), `حُفظ تسعير ${a.name}`)} />)}
    </>
  );
}

function PlanRow({ p, editor, onSave }: { p: PlanPrice; editor: boolean; onSave: (v: { monthly_price_sar: number; yearly_price_sar: number; monthly_whatsapp_alerts: number | null }) => void }) {
  const [m, setM] = useState(String(p.monthly_price_sar));
  const [y, setY] = useState(String(p.yearly_price_sar));
  const [q, setQ] = useState(p.monthly_whatsapp_alerts == null ? "" : String(p.monthly_whatsapp_alerts));
  const disc = Number(m) > 0 ? 1 - Number(y) / (Number(m) * 12) : 0;
  return (
    <tr>
      <td><b>{PLAN_LABEL[p.tier] ?? p.name_ar}</b></td>
      <td><input type="number" min={1} step="1" value={m} disabled={!editor} onChange={(e) => setM(e.target.value)} style={{ width: 100 }} /></td>
      <td><input type="number" min={1} step="1" value={y} disabled={!editor} onChange={(e) => setY(e.target.value)} style={{ width: 110 }} /></td>
      <td className="small">{disc > 0 ? `${Math.round(disc * 100)}% (≈ ${(disc * 12).toFixed(1)} شهر)` : "—"}</td>
      <td><input type="number" min={0} placeholder="بلا حد" value={q} disabled={!editor} onChange={(e) => setQ(e.target.value)} style={{ width: 100 }} /></td>
      <td>{editor && <button className="btn btn-xs" type="button" disabled={!(Number(m) > 0 && Number(y) > 0)}
        onClick={() => onSave({ monthly_price_sar: Number(m), yearly_price_sar: Number(y), monthly_whatsapp_alerts: q === "" ? null : Number(q) })}>حفظ</button>}</td>
    </tr>
  );
}

const ADDON_NAME: Record<string, string> = { ATTENDANCE: "الموارد البشرية (الحضور والإجازات والخصومات)", WA_BOT: "بوت الواتساب للموظفين" };

function AddonForm({ a, editor, onSave }: { a: AddonPrice; editor: boolean;
  onSave: (v: { monthly_price: number; included_tiers: string[]; members: number | null; questions: number | null; included_unlimited: boolean; is_active: boolean }) => void }) {
  const [price, setPrice] = useState(String(a.monthly_price));
  const [tiers, setTiers] = useState<string[]>(a.included_tiers);
  const [members, setMembers] = useState(a.limits.members == null ? "" : String(a.limits.members));
  const [questions, setQuestions] = useState(a.limits.questions == null ? "" : String(a.limits.questions));
  const [unlimited, setUnlimited] = useState(a.limits.included_unlimited ?? true);
  const [active, setActive] = useState(a.is_active);
  return (
    <form className="pricing-addon" onSubmit={(e) => { e.preventDefault(); onSave({ monthly_price: Number(price), included_tiers: tiers, members: members === "" ? null : Number(members),
      questions: questions === "" ? null : Number(questions), included_unlimited: unlimited, is_active: active }); }}>
      <h3>{a.name}</h3>
      {a.limits.grants?.length ? <p className="small muted">تشمل: {a.limits.grants.map((g) => ADDON_NAME[g] ?? g).join(" + ")}</p> : null}
      <div className="grid">
        <div className="field"><label>السعر الشهري (ريال)</label><input type="number" min={0} value={price} disabled={!editor} onChange={(e) => setPrice(e.target.value)} /></div>
        <div className="field"><label>حد الموظفين</label><input type="number" min={1} placeholder="بلا حد" value={members} disabled={!editor} onChange={(e) => setMembers(e.target.value)} /></div>
        {(a.code === "WA_BOT" || a.limits.grants?.includes("WA_BOT")) && <div className="field"><label>حد الأسئلة شهرياً</label><input type="number" min={1} placeholder="بلا حد" value={questions} disabled={!editor} onChange={(e) => setQuestions(e.target.value)} /></div>}
      </div>
      <fieldset className="checks" style={{ margin: "10px 0" }}>
        <legend>مجاني ضمن الباقات</legend>
        {TIERS.map((t) => (
          <label key={t}><input type="checkbox" disabled={!editor} checked={tiers.includes(t)}
            onChange={(e) => setTiers(e.target.checked ? [...tiers, t] : tiers.filter((x) => x !== t))} /> {PLAN_LABEL[t] ?? t}</label>))}
      </fieldset>
      <label className="checks-inline"><input type="checkbox" disabled={!editor} checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} /> بلا حدود في الباقات المشمولة</label>{" "}
      <label className="checks-inline"><input type="checkbox" disabled={!editor} checked={active} onChange={(e) => setActive(e.target.checked)} /> متاحة للاشتراك</label>
      <p className="small muted">الحالي: {tiers.length ? `مجاني في ${tiers.map((t) => PLAN_LABEL[t] ?? t).join(" و")}، و` : ""}{sar(Number(price) || 0)} شهرياً لبقية الباقات.</p>
      {editor && <button className="btn" type="submit">حفظ</button>}
    </form>
  );
}


/** مراجعة الحزمة: إن اختارها أكثر من 60% من مشتركي الموارد البشرية (بعينة 10 فأكثر) يُقترح رفعها إلى 229 تدريجياً. */
function MixCard({ m, bundle }: { m: HrMix; bundle?: AddonPrice }) {
  const total = m.bundle + m.hr_only;
  return (
    <section className="pricing-addon" style={{ marginTop: 16 }}>
      <h3>مراجعة حزمة الموظفين</h3>
      <p className="small">من مشتركي الموارد البشرية المدفوعين: <b>{m.bundle}</b> اختاروا الحزمة و<b>{m.hr_only}</b> الموارد البشرية وحدها
        {total ? <> — نسبة الحزمة <b>{Math.round(m.bundle_share * 100)}%</b> (الحد {Math.round(m.threshold * 100)}%)</> : null}.</p>
      {m.suggest_raise
        ? <p className="hint-box">الحزمة تجاوزت {Math.round(m.threshold * 100)}%: يُقترح رفع سعرها تدريجياً من {bundle ? sar(bundle.monthly_price) : "199"} إلى {sar(m.suggested_bundle_price)} من نموذج «حزمة الموظفين» أدناه (يسري على الاشتراكات الجديدة والتجديدات).</p>
        : <p className="small muted">{total < 10 ? `العينة صغيرة (${total} من 10 على الأقل) للحكم.` : "النسبة دون الحد؛ يبقى السعر كما هو."} المراجعة المقررة بعد ثلاثة أشهر من الإطلاق.</p>}
    </section>
  );
}

function PromoForm({ p, editor, onSave }: { p: PromoStatus; editor: boolean; onSave: (v: { is_active: boolean; max_redemptions: number; free_months: number }) => void }) {
  const [active, setActive] = useState(p.is_active ?? p.active);
  const [max, setMax] = useState(String(p.max ?? 50));
  const [months, setMonths] = useState(String(p.free_months));
  return (
    <form className="pricing-addon" onSubmit={(e) => { e.preventDefault(); onSave({ is_active: active, max_redemptions: Number(max), free_months: Number(months) }); }}>
      <h3>{p.name}</h3>
      <p className="small">استفاد <b>{p.used ?? 0}</b> من <b>{p.max}</b> — المتبقي <b>{p.remaining}</b>{!p.active && " · متوقف"}</p>
      <div className="grid">
        <div className="field"><label>عدد المستفيدين الأقصى</label><input type="number" min={p.used ?? 1} value={max} disabled={!editor} onChange={(e) => setMax(e.target.value)} /></div>
        <div className="field"><label>الأشهر المجانية</label><input type="number" min={1} max={12} value={months} disabled={!editor} onChange={(e) => setMonths(e.target.value)} /></div>
      </div>
      <label className="checks-inline"><input type="checkbox" checked={active} disabled={!editor} onChange={(e) => setActive(e.target.checked)} /> العرض فعّال</label>
      <p className="small muted">مرة واحدة لكل منشأة باشتراك مدفوع ساري، ولمن لم يشترك في الموارد البشرية من قبل، بالشريحة المناسبة لعدد موظفيها.</p>
      {editor && <button className="btn btn-xs" type="submit">حفظ</button>}
    </form>
  );
}

