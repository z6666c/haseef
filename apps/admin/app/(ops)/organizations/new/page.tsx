"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LEGAL_TYPE_LABEL, PLAN_LABEL, SIZE_LABEL } from "@haseef/shared";
import { TempPasswordDialog, useCan } from "@/components/ui";
import { api } from "@/lib/session";

const EMPTY = {
  name: "", cr_number: "", entity_legal_type: "LLC", industry_type: "", commercial_size: "SMALL",
  plan_tier: "PROFESSIONAL_GRC", trial_days: 14, admin_email: "", admin_full_name: "", admin_phone: "",
};

export default function NewOrganization() {
  const router = useRouter();
  const can = useCan();
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; pw: string | null } | null>(null);

  if (!can("orgs.manage")) return <p className="error">إنشاء المنشآت يتطلب صلاحية إدارة المنشآت.</p>;
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: k === "trial_days" ? Number(e.target.value) : e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.admin.createOrg({
        ...f,
        industry_type: f.industry_type || undefined,
        admin_phone: f.admin_phone || undefined,
      });
      if (r.temporary_password) setCreated({ id: r.id, pw: r.temporary_password });
      else router.push(`/organizations/${r.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر إنشاء المنشأة");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="crumbs"><Link href="/organizations">المنشآت</Link> / منشأة جديدة</p>
      <h1>منشأة جديدة</h1>
      <form className="form-card" onSubmit={submit}>
        <fieldset>
          <legend>بيانات المنشأة</legend>
          <div className="grid">
            <div className="field"><label htmlFor="name">اسم المنشأة</label>
              <input id="name" required minLength={2} value={f.name} onChange={set("name")} /></div>
            <div className="field"><label htmlFor="cr">السجل التجاري (10 أرقام)</label>
              <input id="cr" required pattern="\d{10}" inputMode="numeric" dir="ltr" value={f.cr_number} onChange={set("cr_number")} /></div>
            <div className="field"><label htmlFor="lt">الكيان النظامي</label>
              <select id="lt" value={f.entity_legal_type} onChange={set("entity_legal_type")}>
                {Object.entries(LEGAL_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div className="field"><label htmlFor="sz">الحجم</label>
              <select id="sz" value={f.commercial_size} onChange={set("commercial_size")}>
                {Object.entries(SIZE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div className="field"><label htmlFor="ind">القطاع (اختياري)</label>
              <input id="ind" value={f.industry_type} onChange={set("industry_type")} placeholder="مثل: المقاولات" /></div>
          </div>
        </fieldset>

        <fieldset>
          <legend>الاشتراك</legend>
          <div className="grid">
            <div className="field"><label htmlFor="plan">الباقة</label>
              <select id="plan" value={f.plan_tier} onChange={set("plan_tier")}>
                {Object.entries(PLAN_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div className="field"><label htmlFor="trial">أيام الفترة التجريبية (0 = بلا تجربة)</label>
              <input id="trial" type="number" min={0} max={60} value={f.trial_days} onChange={set("trial_days")} /></div>
          </div>
          {f.trial_days === 0 && <p className="hint">بلا فترة تجريبية لا تعمل التنبيهات حتى تُسجَّل أول دفعة.</p>}
        </fieldset>

        <fieldset>
          <legend>مدير المنشأة</legend>
          <div className="grid">
            <div className="field"><label htmlFor="an">الاسم الكامل</label>
              <input id="an" required minLength={2} value={f.admin_full_name} onChange={set("admin_full_name")} /></div>
            <div className="field"><label htmlFor="ae">البريد الإلكتروني</label>
              <input id="ae" type="email" required dir="ltr" value={f.admin_email} onChange={set("admin_email")} /></div>
            <div className="field"><label htmlFor="ap">جوال الواتساب (اختياري)</label>
              <input id="ap" dir="ltr" pattern="\+9665\d{8}" placeholder="+9665XXXXXXXX" value={f.admin_phone} onChange={set("admin_phone")} /></div>
          </div>
          <p className="hint">إن كان البريد مسجلاً مسبقاً يُضاف صاحبه مديراً للمنشأة دون كلمة مرور جديدة.</p>
        </fieldset>

        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <button className="btn btn-action" type="submit" disabled={busy}>{busy ? "جارٍ الإنشاء…" : "أنشئ المنشأة"}</button>
          <Link className="btn btn-quiet" href="/organizations">إلغاء</Link>
        </div>
      </form>

      <TempPasswordDialog password={created?.pw ?? null} email={f.admin_email}
                          onClose={() => created && router.push(`/organizations/${created.id}`)} />
    </>
  );
}
