"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ENTITY_RELATION_LABEL, LEGAL_TYPE_LABEL, ORG_ROLE_LABEL, SIZE_LABEL, scoreTone,
  type GroupEntity, type GroupEntityInput, type GroupOverview,
} from "@haseef/shared";
import { api, getSession, setSession } from "@/lib/session";

const EMPTY: GroupEntityInput = { name: "", cr_number: "", entity_legal_type: "LLC", entity_relation: "SUBSIDIARY", industry_type: null, commercial_size: "SMALL" };

export default function GroupPage() {
  const [g, setG] = useState<GroupOverview | null>(null);
  const [form, setForm] = useState<GroupEntityInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => { api.group().then(setG).catch((e: Error) => setError(e.message)); }, []);
  useEffect(load, [load]);

  function open(e: GroupEntity) {
    const s = getSession();
    if (!s) return;
    setSession({ ...s, orgId: e.id });
    window.location.href = window.location.pathname.replace(/\/group\/?$/, "/");
  }

  async function add(ev: React.FormEvent) {
    ev.preventDefault();
    if (!form) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await api.addGroupEntity(form);
      setNotice(`أُضيفت «${form.name}» للمجموعة بالهيكل الأساسي والالتزامات المنطبقة، وأنت مديرها. ستظهر في قائمة التبديل بعد تحديث الصفحة.`);
      setForm(null); load();
    } catch (e) { setError(e instanceof Error ? e.message : "تعذّرت الإضافة"); }
    finally { setBusy(false); }
  }

  if (!g) return error ? <p className="error" role="alert">{error}</p> : <div className="boot" aria-busy="true" />;

  return (
    <>
      <header className="page-head">
        <h1>المجموعة والمنشآت التابعة</h1>
        <p className="muted">لوحة موحدة للشركة الأم وتابعاتها وفروعها: المؤشر والتراخيص والسياسات والالتزامات لكل منشأة في مكان واحد،
          مع الانتقال لأي منشأة بنقرة. لا يظهر لك إلا ما أنت عضو فيه.</p>
      </header>
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {!g.available ? (
        <div className="hint-box">
          <p><strong>المنشآت المتعددة متاحة في باقة كبار العملاء.</strong></p>
          <p>تشمل: لوحة موحدة للمجموعة، إضافة حتى {g.max_entities} منشأة تابعة أو فرع تحت اشتراك واحد، وتقرير مجلس الإدارة السنوي.
            تواصل مع فريق حصيف للترقية.</p>
        </div>
      ) : (
        <>
          {g.totals && (
            <dl className="obl-stats">
              <div><dt>منشآت المجموعة</dt><dd>{g.totals.entities}</dd></div>
              <div><dt>متوسط مؤشر حصافة</dt><dd data-s={g.totals.avg_score !== null && g.totals.avg_score >= 85 ? "IN_PLACE" : "PENDING"}>{g.totals.avg_score ?? "—"}</dd></div>
              <div><dt>تراخيص منتهية</dt><dd data-s={g.totals.expired ? "LATE" : "IN_PLACE"}>{g.totals.expired}</dd></div>
              <div><dt>تنتهي خلال 30 يوماً</dt><dd>{g.totals.expiring}</dd></div>
              <div><dt>التزامات معلقة</dt><dd>{g.totals.obligations_pending}</dd></div>
            </dl>
          )}

          <table className="deadlines group-table">
            <thead><tr><th>المنشأة</th><th>المؤشر</th><th>التراخيص</th><th>السياسات</th><th>الالتزامات</th><th>الهيكل</th><th></th></tr></thead>
            <tbody>
              {g.entities.map((e) => (
                <tr key={e.id}>
                  <td>
                    <strong>{e.name}</strong>
                    <div className="small muted">
                      {e.entity_relation ? ENTITY_RELATION_LABEL[e.entity_relation] : "الشركة الأم"} · {LEGAL_TYPE_LABEL[e.entity_legal_type] ?? e.entity_legal_type}
                      {e.commercial_size && <> · {SIZE_LABEL[e.commercial_size]}</>} · <span dir="ltr">{e.cr_number}</span>
                    </div>
                    <div className="small muted">دورك: {ORG_ROLE_LABEL[e.role] ?? e.role}</div>
                  </td>
                  <td><span className="score-pill" data-tone={scoreTone(e.haseef_score)}>{e.haseef_score ?? "—"}</span></td>
                  <td>
                    {e.items.expired > 0 && <span className="risk" data-r="CRITICAL">{e.items.expired} منتهٍ</span>}{" "}
                    {e.items.expiring > 0 && <span className="risk" data-r="HIGH">{e.items.expiring} قريب</span>}
                    {!e.items.expired && !e.items.expiring && <span className="muted small">{e.items.total} سارية</span>}
                  </td>
                  <td>{e.policies_due ? <span className="risk" data-r="HIGH">{e.policies_due} للمراجعة</span> : <span className="muted small">محدّثة</span>}</td>
                  <td>{e.obligations.total - e.obligations.pending} / {e.obligations.total}</td>
                  <td>{e.structure_score !== null ? `${Math.round(e.structure_score)}%` : "—"}</td>
                  <td><button className="link-btn" type="button" onClick={() => open(e)}>فتح المنشأة ←</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!!g.hidden_entities && <p className="small muted">{g.hidden_entities} منشأة في المجموعة لست عضواً فيها ولا تظهر هنا.</p>}

          {g.can_manage && (form ? (
            <form className="panel" onSubmit={add} style={{ marginTop: 20 }}>
              <h2>إضافة منشأة للمجموعة</h2>
              <div className="grid">
                <div className="field"><label htmlFor="en">اسم المنشأة</label>
                  <input id="en" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div className="field"><label htmlFor="ecr">السجل التجاري (10 أرقام)</label>
                  <input id="ecr" required pattern="\d{10}" inputMode="numeric" dir="ltr" value={form.cr_number}
                         onChange={(e) => setForm({ ...form, cr_number: e.target.value.trim() })} /></div>
                <div className="field"><label htmlFor="erel">العلاقة بالشركة الأم</label>
                  <select id="erel" value={form.entity_relation} onChange={(e) => setForm({ ...form, entity_relation: e.target.value as GroupEntityInput["entity_relation"] })}>
                    {Object.entries(ENTITY_RELATION_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                <div className="field"><label htmlFor="elt">الكيان النظامي</label>
                  <select id="elt" value={form.entity_legal_type} onChange={(e) => setForm({ ...form, entity_legal_type: e.target.value })}>
                    {Object.entries(LEGAL_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                <div className="field"><label htmlFor="ein">القطاع</label>
                  <input id="ein" value={form.industry_type ?? ""} onChange={(e) => setForm({ ...form, industry_type: e.target.value || null })} /></div>
                <div className="field"><label htmlFor="esz">الحجم</label>
                  <select id="esz" value={form.commercial_size ?? ""} onChange={(e) => setForm({ ...form, commercial_size: (e.target.value || null) as GroupEntityInput["commercial_size"] })}>
                    {Object.entries(SIZE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              </div>
              <p className="small muted">تُنشأ المنشأة بالهيكل الأساسي لنوعها والالتزامات المنطبقة عليها، وتدخل ضمن اشتراك الشركة الأم حتى نهايته.</p>
              <div className="form-actions">
                <button className="btn btn-action" type="submit" disabled={busy}>{busy ? "جارٍ الإضافة…" : "إضافة"}</button>
                <button className="btn btn-quiet" type="button" onClick={() => setForm(null)}>إلغاء</button>
              </div>
            </form>
          ) : (
            <button className="btn btn-quiet" type="button" style={{ marginTop: 16 }} onClick={() => setForm({ ...EMPTY })}>+ إضافة منشأة تابعة أو فرع</button>
          ))}
        </>
      )}
    </>
  );
}
