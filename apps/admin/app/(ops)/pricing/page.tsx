"use client";

import { useCallback, useEffect, useState } from "react";
import { PLAN_LABEL, sar, type AddonPrice, type PlanPrice, type PublicPricing } from "@haseef/shared";
import { useCan } from "@/components/ui";
import { api } from "@/lib/session";

const TIERS = ["ESSENTIAL", "PROFESSIONAL_GRC", "ENTERPRISE"];

export default function PricingPage() {
  const can = useCan();
  const editor = can("billing.manage");
  const [d, setD] = useState<PublicPricing | null>(null);
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

function AddonForm({ a, editor, onSave }: { a: AddonPrice; editor: boolean;
  onSave: (v: { monthly_price: number; included_tiers: string[]; members: number | null; questions: number | null; included_unlimited: boolean; is_active: boolean }) => void }) {
  const [price, setPrice] = useState(String(a.monthly_price));
  const [tiers, setTiers] = useState<string[]>(a.included_tiers);
  const [members, setMembers] = useState(a.limits.members == null ? "" : String(a.limits.members));
  const [questions, setQuestions] = useState(a.limits.questions == null ? "" : String(a.limits.questions));
  const [unlimited, setUnlimited] = useState(a.limits.included_unlimited ?? true);
  const [active, setActive] = useState(a.is_active);
  return (
    <form className="panel" onSubmit={(e) => { e.preventDefault(); onSave({ monthly_price: Number(price), included_tiers: tiers, members: members === "" ? null : Number(members),
      questions: questions === "" ? null : Number(questions), included_unlimited: unlimited, is_active: active }); }}>
      <h3 style={{ marginTop: 0 }}>{a.name}</h3>
      <div className="grid">
        <div className="field"><label>السعر الشهري (ريال)</label><input type="number" min={0} value={price} disabled={!editor} onChange={(e) => setPrice(e.target.value)} /></div>
        <div className="field"><label>حد الموظفين</label><input type="number" min={1} placeholder="بلا حد" value={members} disabled={!editor} onChange={(e) => setMembers(e.target.value)} /></div>
        <div className="field"><label>حد الأسئلة شهرياً</label><input type="number" min={1} placeholder="بلا حد" value={questions} disabled={!editor} onChange={(e) => setQuestions(e.target.value)} /></div>
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
