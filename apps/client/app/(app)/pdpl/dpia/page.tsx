"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DPIA_STATUS_LABEL, MITIGATION_STATUS_LABEL, RISK4_LABEL, dpiaAssess, dpiaSuggest,
  type Dpia, type DpiaInput, type DpiaMitigation, type DpiaQuestionnaire, type RopaRecord,
} from "@haseef/shared";
import { api } from "@/lib/session";

const fmt = (d: string | null) => d ? new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { dateStyle: "medium" }).format(new Date(d)) : "—";
const RISK_ATTR: Record<string, string> = { LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH", CRITICAL: "CRITICAL" };
const EMPTY: DpiaInput = { project_name: "", description: null, related_record_id: null, answers: {}, mitigations: null, dpo_opinion: null };

export default function DpiaPage() {
  const [qn, setQn] = useState<DpiaQuestionnaire | null>(null);
  const [rows, setRows] = useState<Dpia[] | null>(null);
  const [records, setRecords] = useState<RopaRecord[]>([]);
  const [edit, setEdit] = useState<{ id: string | null; v: DpiaInput } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => { api.dpiaList().then(setRows).catch((e: Error) => setError(e.message)); }, []);
  useEffect(() => {
    api.dpiaQuestionnaire().then(setQn).catch((e: Error) => setError(e.message));
    api.ropa().then(setRecords).catch(() => {});
    load();
  }, [load]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setError(null); setNotice(null);
    try { await fn(); setNotice(ok); load(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "تعذّر التنفيذ"); return false; }
  }

  if (!qn || !rows) return error ? <p className="error" role="alert">{error}</p> : <div className="boot" aria-busy="true" />;

  return (
    <>
      <header className="page-head">
        <p className="crumbs"><Link href="/pdpl">حماية البيانات الشخصية</Link> / تقييم الأثر</p>
        <h1>تقييم الأثر على حماية البيانات (DPIA)</h1>
        <p className="muted">قبل إطلاق أي نشاط عالي الخطورة — بيانات حساسة، مراقبة، قرارات آلية، نقل خارج المملكة — قيّم أثره على أصحاب البيانات،
          ووثّق المعالجات ورأي مسؤول حماية البيانات، ثم اعتمده. الاستبيان إصدار {qn.version} من {qn.questions.length} سؤالاً.</p>
      </header>
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {edit ? (
        <DpiaEditor qn={qn} records={records} init={edit.v} isNew={!edit.id} onCancel={() => setEdit(null)}
          onSave={async (v) => { if (await act(() => edit.id ? api.updateDpia(edit.id, v) : api.addDpia(v), "حُفظ التقييم")) setEdit(null); }} />
      ) : (
        <div className="head-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>التقييمات ({rows.length})</h2>
          <button className="btn btn-action" type="button" onClick={() => setEdit({ id: null, v: { ...EMPTY } })}>+ تقييم جديد</button>
        </div>
      )}

      {!edit && (rows.length === 0 ? (
        <p className="empty">لا تقييمات بعد. ابدأ بأي نشاط يعالج بيانات حساسة أو يراقب الأشخاص أو ينقل البيانات خارج المملكة.</p>
      ) : (
        <ul className="ropa-list">
          {rows.map((d) => (
            <li key={d.id}>
              <div className="res-head">
                <strong>{d.project_name}</strong>
                <span className="status-chip" data-s={d.status === "APPROVED" ? "IN_PLACE" : d.status === "COMPLETED" ? "PENDING" : "DRAFT"}>{DPIA_STATUS_LABEL[d.status]}</span>
                {d.required && <span className="draft-badge">مطلوب نظاماً</span>}
              </div>
              {d.description && <p>{d.description}</p>}
              <dl className="ropa-facts">
                <div><dt>الخطر الأولي</dt><dd><span className="risk" data-r={RISK_ATTR[d.risk_level]}>{RISK4_LABEL[d.risk_level]} · {d.risk_score}</span></dd></div>
                <div><dt>الخطر المتبقي</dt><dd><span className="risk" data-r={RISK_ATTR[d.residual_level]}>{RISK4_LABEL[d.residual_level]} · {d.residual_score}</span></dd></div>
                <div><dt>المعالجات</dt><dd>{d.mitigations.length - d.open_mitigations} من {d.mitigations.length} منفّذة</dd></div>
                {d.related_activity && <div><dt>النشاط المرتبط</dt><dd>{d.related_activity}</dd></div>}
                <div><dt>آخر تحديث</dt><dd>{fmt(d.updated_at)}</dd></div>
                {d.approved_at && <div><dt>الاعتماد</dt><dd>{d.approved_by_name} · {fmt(d.approved_at)}</dd></div>}
              </dl>
              {d.dpo_opinion && <p className="small"><strong>رأي مسؤول حماية البيانات:</strong> {d.dpo_opinion}</p>}
              <div className="row-actions-cell" style={{ textAlign: "start" }}>
                {d.status !== "APPROVED" && <button className="link-btn" type="button" onClick={() => setEdit({ id: d.id, v: {
                  project_name: d.project_name, description: d.description, related_record_id: d.related_record_id, answers: d.answers,
                  mitigations: d.mitigations, dpo_opinion: d.dpo_opinion } })}>تعديل</button>}
                {d.status === "IN_PROGRESS" && <button className="link-btn" type="button"
                  onClick={() => act(() => api.dpiaStatus(d.id, "COMPLETED"), "أُنهي التقييم وأصبح جاهزاً للاعتماد")}>إنهاء التقييم</button>}
                {d.status === "COMPLETED" && <>
                  <button className="link-btn" type="button" onClick={() => act(() => api.dpiaStatus(d.id, "APPROVED"), "اعتُمد التقييم")}>اعتماد (مدير المنشأة)</button>
                  <button className="link-btn" type="button" onClick={() => act(() => api.dpiaStatus(d.id, "IN_PROGRESS"), "أُعيد للتعديل")}>إعادة للتعديل</button>
                </>}
                {d.status !== "APPROVED" && <button className="link-btn danger" type="button"
                  onClick={() => window.confirm("حذف هذا التقييم؟") && act(() => api.deleteDpia(d.id), "حُذف التقييم")}>حذف</button>}
              </div>
            </li>
          ))}
        </ul>
      ))}
      <p className="small muted">نموذج تقييم الأثر الكامل للطباعة والتوقيع متاح في <Link href="/library">المكتبة المرجعية</Link>.</p>
    </>
  );
}

function DpiaEditor({ qn, records, init, isNew, onSave, onCancel }: {
  qn: DpiaQuestionnaire; records: RopaRecord[]; init: DpiaInput; isNew: boolean;
  onSave: (v: DpiaInput) => Promise<void>; onCancel: () => void;
}) {
  const [v, setV] = useState<DpiaInput>(init);
  const [mits, setMits] = useState<DpiaMitigation[]>(init.mitigations ?? []);
  const [busy, setBusy] = useState(false);
  const sections = useMemo(() => [...new Set(qn.questions.map((q) => q.section))], [qn]);
  const a = dpiaAssess(qn.questions, v.answers, mits);

  function answer(key: string, yes: boolean) {
    const answers = { ...v.answers, [key]: yes };
    setV({ ...v, answers });
    // المعالجات تتبع الإجابات: نضيف المقترحة للعوامل الجديدة ونزيل ما لم يعد عامل خطر
    const suggested = dpiaSuggest(qn.questions, answers);
    setMits((cur) => {
      const keep = cur.filter((m) => answers[m.code] || !qn.questions.some((q) => q.key === m.code));
      const have = new Set(keep.map((m) => m.code));
      return [...keep, ...suggested.filter((m) => !have.has(m.code))];
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await onSave({ ...v, mitigations: mits });
    setBusy(false);
  }

  return (
    <form className="panel dpia-editor" onSubmit={submit}>
      <h2>{isNew ? "تقييم أثر جديد" : "تعديل التقييم"}</h2>
      <div className="grid">
        <div className="field field-wide"><label htmlFor="pn">المشروع أو النشاط</label>
          <input id="pn" required minLength={3} value={v.project_name} placeholder="مثال: نظام الحضور ببصمة الوجه"
                 onChange={(e) => setV({ ...v, project_name: e.target.value })} /></div>
        <div className="field field-wide"><label htmlFor="ds">الوصف: ما البيانات، ومن أصحابها، وكيف تُعالج، ومن يصل إليها</label>
          <textarea id="ds" rows={3} value={v.description ?? ""} onChange={(e) => setV({ ...v, description: e.target.value || null })} /></div>
        <div className="field"><label htmlFor="rr">النشاط في سجل المعالجة (اختياري)</label>
          <select id="rr" value={v.related_record_id ?? ""} onChange={(e) => setV({ ...v, related_record_id: e.target.value || null })}>
            <option value="">—</option>
            {records.map((r) => <option key={r.id} value={r.id}>{r.activity_name}</option>)}
          </select></div>
      </div>

      <div className="dpia-score" aria-live="polite">
        <div><span className="muted small">الخطر الأولي</span><b className="risk" data-r={a.level}>{RISK4_LABEL[a.level]} · {a.score}</b></div>
        <div><span className="muted small">الخطر المتبقي بعد المعالجات المنفذة</span><b className="risk" data-r={a.residual_level}>{RISK4_LABEL[a.residual_level]} · {a.residual_score}</b></div>
        <div><span className="muted small">الحكم</span><b>{a.required ? "التقييم مطلوب نظاماً قبل بدء المعالجة" : "التقييم موصى به (ليس إلزامياً)"}</b></div>
      </div>

      {sections.map((sec) => (
        <fieldset key={sec} className="dpia-section">
          <legend>{sec}</legend>
          {qn.questions.filter((q) => q.section === sec).map((q) => (
            <div key={q.key} className="dpia-q">
              <p>{q.q} {q.trigger && <span className="tag tag-quiet" title="الإجابة بنعم تجعل التقييم مطلوباً">مُلزِم</span>}</p>
              <div className="seg" role="radiogroup" aria-label={q.q}>
                <button type="button" role="radio" aria-checked={v.answers[q.key] === true} onClick={() => answer(q.key, true)}>نعم</button>
                <button type="button" role="radio" aria-checked={v.answers[q.key] === false} onClick={() => answer(q.key, false)}>لا</button>
              </div>
            </div>
          ))}
        </fieldset>
      ))}

      <fieldset className="dpia-section">
        <legend>المعالجات ({mits.length})</legend>
        {mits.length === 0 && <p className="muted small">لا عوامل خطر بعد. أجب على الأسئلة أعلاه وستظهر المعالجات المقترحة.</p>}
        {mits.map((m, i) => (
          <div key={m.code + i} className="dpia-mit">
            <textarea rows={2} value={m.text} aria-label="المعالجة"
                      onChange={(e) => setMits(mits.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} />
            <input placeholder="المسؤول" value={m.owner ?? ""} aria-label="المسؤول"
                   onChange={(e) => setMits(mits.map((x, j) => j === i ? { ...x, owner: e.target.value || null } : x))} />
            <select value={m.status} aria-label="الحالة"
                    onChange={(e) => setMits(mits.map((x, j) => j === i ? { ...x, status: e.target.value as DpiaMitigation["status"] } : x))}>
              {Object.entries(MITIGATION_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
        ))}
      </fieldset>

      <div className="field"><label htmlFor="op">رأي مسؤول حماية البيانات الشخصية (مطلوب قبل الإنهاء)</label>
        <textarea id="op" rows={3} value={v.dpo_opinion ?? ""} onChange={(e) => setV({ ...v, dpo_opinion: e.target.value || null })} /></div>

      <div className="form-actions">
        <button className="btn btn-action" type="submit" disabled={busy}>{busy ? "جارٍ الحفظ…" : "حفظ"}</button>
        <button className="btn btn-quiet" type="button" onClick={onCancel}>إلغاء</button>
      </div>
    </form>
  );
}
