"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BODY_TYPE_LABEL, GOV_DOMAIN_LABEL, LEGAL_TYPE_LABEL, LEVEL_LABEL, POSITION_LABEL, REVIEW_BADGE, SIZE_LABEL,
  type BodyInput, type BodyType, type CheckResult, type GovBody, type GovernanceProfile, type GovernanceStructure,
  type MemberInput, type MemberPosition,
} from "@haseef/shared";
import { api } from "@/lib/session";

const EMPTY_MEMBER: MemberInput = { full_name: "", position: "MEMBER", is_independent: false, is_executive: false,
                                    appointed_on: null, term_ends_on: null };

function fmtDate(d: string | null) {
  return d ? new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { dateStyle: "medium" }).format(new Date(d)) : "—";
}

export default function GovernancePage() {
  const [data, setData] = useState<GovernanceStructure | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.governance().then(setData).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true); setError(null); setNotice(null);
    try { await fn(); if (ok) setNotice(ok); load(); }
    catch (e) { setError(e instanceof Error ? e.message : "تعذّر تنفيذ الطلب"); }
    finally { setBusy(false); }
  }

  if (!data) return error ? <p className="error" role="alert">{error}</p> : <div className="boot" aria-busy="true" />;
  const check = data.latest_check;

  return (
    <>
      <header className="page-head page-head-row">
        <div>
          <h1>الحوكمة وهيكل الشركة</h1>
          <p className="muted">
            {LEGAL_TYPE_LABEL[data.legal_type] ?? data.legal_type}{data.size ? ` · ${SIZE_LABEL[data.size] ?? data.size}` : ""}.
            {" "}عدّل الهيكل بما يطابق واقع منشأتك، ثم افحصه مقابل معايير الحوكمة.
          </p>
        </div>
        <button className="btn btn-action" type="button" disabled={busy}
                onClick={() => act(() => api.runCheck(), "اكتمل فحص الهيكل")}>افحص الهيكل الآن</button>
      </header>

      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      <CheckPanel results={check?.results ?? []} score={check?.structure_score ?? null} at={check?.created_at ?? null}
                  counts={check ? { passed: check.passed, failed: check.failed, na: check.not_applicable } : null} />

      <section className="gov-section">
        <div className="section-head">
          <h2>الهيكل التنظيمي</h2>
          <p className="muted">بدأ من القالب الأساسي لكيانك. أضف أو عدّل أو احذف ما يلزم.</p>
        </div>
        {data.bodies.length === 0 ? (
          <div className="ledger-empty">
            <p>لا يوجد هيكل بعد. ابدأ من القالب الأساسي لـ{LEGAL_TYPE_LABEL[data.legal_type]}.</p>
            <button className="btn btn-action" type="button" disabled={busy}
                    onClick={() => act(() => api.applyTemplate(), "أُضيف الهيكل الأساسي")}>أنشئ الهيكل الأساسي</button>
          </div>
        ) : (
          <div className="bodies">
            {data.bodies.map((b) => <BodyCard key={b.id} body={b} busy={busy} act={act} />)}
          </div>
        )}
        <AddBody busy={busy} onAdd={(b) => act(() => api.addBody(b), `أُضيف: ${b.name}`)} />
        {data.example_title && (
          <div className="example-box">
            <div>
              <strong>مثال جاهز من خبراء حصيف:</strong> {data.example_title}
              <p className="muted small">هيكل متكامل بالأجهزة واللجان والأعضاء والتصنيفات كما يبنيه مستشار حوكمة. يستبدل هيكلك الحالي، ثم تعدّل الأسماء والتواريخ.</p>
            </div>
            <button className="btn btn-quiet" type="button" disabled={busy}
                    onClick={() => { if (window.confirm("سيُستبدل الهيكل الحالي بالمثال الجاهز. متابعة؟")) act(() => api.applyExample(), "حُمّل المثال الجاهز وأُعيد الفحص"); }}>
              ابدأ من المثال الجاهز</button>
          </div>
        )}
        {data.bodies.length > 0 && (
          <button className="link-btn" type="button" disabled={busy}
                  onClick={() => act(() => api.applyTemplate(), "أُكملت الأجهزة الناقصة من القالب")}>
            أكمل الأجهزة الناقصة من القالب الأساسي
          </button>
        )}
      </section>

      <ProfileForm profile={data.profile} busy={busy} onSave={(p) => act(() => api.updateProfile(p), "حُفظ ملف الحوكمة وأُعيد الفحص")} />
    </>
  );
}

// ------------------------------------------------------------------ نتائج الفحص
function CheckPanel({ results, score, at, counts }: {
  results: CheckResult[]; score: number | null; at: string | null; counts: { passed: number; failed: number; na: number } | null;
}) {
  const [showPassed, setShowPassed] = useState(false);
  if (!counts) {
    return <div className="panel check-panel"><p className="muted">لم يُفحص الهيكل بعد. اضغط «افحص الهيكل الآن» لمعرفة الفجوات.</p></div>;
  }
  const failsM = results.filter((r) => r.status === "FAIL" && r.level === "MANDATORY");
  const failsR = results.filter((r) => r.status === "FAIL" && r.level === "RECOMMENDED");
  const passed = results.filter((r) => r.status === "PASS");
  const na = results.filter((r) => r.status === "NA");
  const tone = score === null ? "none" : score >= 85 ? "good" : score >= 50 ? "warn" : "bad";
  return (
    <section className="panel check-panel" aria-labelledby="check-h">
      <div className="check-summary" data-tone={tone}>
        <div className="check-score">
          <b>{score === null ? "—" : Math.round(score)}</b>{score !== null && <span>%</span>}
          <small>استيفاء المعايير الإلزامية</small>
        </div>
        <div>
          <h2 id="check-h">نتيجة فحص الهيكل</h2>
          <p className="muted small">آخر فحص: {at ? new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { dateStyle: "medium", timeStyle: "short" }).format(new Date(at)) : "—"}</p>
          <dl className="check-counts">
            <div><dt>مستوفى</dt><dd data-s="PASS">{counts.passed}</dd></div>
            <div><dt>غير مستوفى</dt><dd data-s="FAIL">{counts.failed}</dd></div>
            <div><dt>لا ينطبق</dt><dd>{counts.na}</dd></div>
          </dl>
        </div>
      </div>

      {failsM.length > 0 && <ResultList title="فجوات إلزامية — ابدأ بها" items={failsM} />}
      {failsR.length > 0 && <ResultList title="ممارسات فضلى غير مطبقة" items={failsR} />}
      {failsM.length === 0 && failsR.length === 0 && <p className="ok-line">الهيكل يستوفي كل المعايير المنطبقة على منشأتك.</p>}

      <button className="link-btn" type="button" onClick={() => setShowPassed(!showPassed)} aria-expanded={showPassed}>
        {showPassed ? "إخفاء" : "عرض"} المعايير المستوفاة ({passed.length}){na.length ? ` وغير المنطبقة (${na.length})` : ""}
      </button>
      {showPassed && <ResultList title="" items={[...passed, ...na]} />}
    </section>
  );
}

function ResultList({ title, items }: { title: string; items: CheckResult[] }) {
  return (
    <div className="results">
      {title && <h3>{title}</h3>}
      <ul>
        {items.map((r) => (
          <li key={r.code} data-s={r.status} data-sev={r.severity}>
            <div className="res-head">
              <strong>{r.title}</strong>
              <span className="tag">{LEVEL_LABEL[r.level]}</span>
              <span className="tag tag-quiet">{GOV_DOMAIN_LABEL[r.domain] ?? r.domain}</span>
              {r.review_status === "DRAFT" && <span className="draft-badge">{REVIEW_BADGE}</span>}
            </div>
            <p className="res-msg">{r.message}</p>
            <details>
              <summary>ما المطلوب؟</summary>
              <p>{r.description}</p>
              {r.legal_reference && (
                <p className="small muted">المرجع: {r.source_url
                  ? <a href={r.source_url} target="_blank" rel="noopener noreferrer">{r.legal_reference}</a>
                  : r.legal_reference}</p>
              )}
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ الأجهزة والأعضاء
function BodyCard({ body, busy, act }: { body: GovBody; busy: boolean; act: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<BodyInput>({ body_type: body.body_type, name: body.name, mandate: body.mandate, meetings_per_year: body.meetings_per_year });
  const [member, setMember] = useState<MemberInput>(EMPTY_MEMBER);
  const [editMember, setEditMember] = useState<string | null>(null);

  const isCollective = !["OWNER", "MANAGER", "COMPANY_SECRETARY", "DPO"].includes(body.body_type);

  return (
    <article className="body-card">
      {!editing ? (
        <header className="body-head">
          <div>
            <p className="body-type">{BODY_TYPE_LABEL[body.body_type] ?? body.body_type}</p>
            <h3>{body.name}</h3>
            {body.mandate && <p className="muted small">{body.mandate}</p>}
            {body.meetings_per_year ? <p className="small">الاجتماعات: {body.meetings_per_year} في السنة على الأقل</p> : null}
          </div>
          <div className="body-actions">
            <button className="link-btn" type="button" onClick={() => setEditing(true)}>تعديل</button>
            <button className="link-btn danger" type="button" disabled={busy}
                    onClick={() => { if (window.confirm(`حذف «${body.name}» وكل أعضائه؟`)) act(() => api.deleteBody(body.id), "حُذف الجهاز"); }}>حذف</button>
          </div>
        </header>
      ) : (
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); act(() => api.updateBody(body.id, form), "حُفظ التعديل").then(() => setEditing(false)); }}>
          <BodyFields value={form} onChange={setForm} />
          <div className="actions">
            <button className="btn btn-action" type="submit" disabled={busy}>حفظ</button>
            <button className="btn btn-quiet" type="button" onClick={() => setEditing(false)}>إلغاء</button>
          </div>
        </form>
      )}

      {body.members.length > 0 && (
        <table className="members">
          <thead><tr><th>الاسم</th><th>الصفة</th><th>التصنيف</th><th>انتهاء العضوية</th><th><span className="sr-only">إجراءات</span></th></tr></thead>
          <tbody>
            {body.members.map((m) => editMember === m.id ? (
              <tr key={m.id}><td colSpan={5}>
                <MemberForm initial={m} busy={busy} onCancel={() => setEditMember(null)}
                            onSave={(v) => act(() => api.updateMember(m.id, v), "حُفظ العضو").then(() => setEditMember(null))} />
              </td></tr>
            ) : (
              <tr key={m.id}>
                <td>{m.full_name}</td>
                <td>{POSITION_LABEL[m.position]}</td>
                <td>{m.is_independent ? "مستقل" : m.is_executive ? "تنفيذي" : "غير تنفيذي"}</td>
                <td data-expired={m.term_ends_on ? new Date(m.term_ends_on) < new Date() : undefined}>{fmtDate(m.term_ends_on)}</td>
                <td className="row-actions-cell">
                  <button className="link-btn" type="button" onClick={() => setEditMember(m.id)}>تعديل</button>
                  <button className="link-btn danger" type="button" disabled={busy}
                          onClick={() => act(() => api.deleteMember(m.id), "حُذف العضو")}>حذف</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {adding ? (
        <MemberForm initial={member} busy={busy} onCancel={() => setAdding(false)}
                    onSave={(v) => act(() => api.addMember(body.id, v), `أُضيف ${v.full_name}`).then(() => { setMember(EMPTY_MEMBER); setAdding(false); })} />
      ) : (
        <button className="link-btn" type="button" onClick={() => setAdding(true)}>
          + {isCollective ? "إضافة عضو" : body.members.length ? "إضافة شخص آخر" : "تحديد الشخص"}
        </button>
      )}
    </article>
  );
}

function BodyFields({ value, onChange }: { value: BodyInput; onChange: (v: BodyInput) => void }) {
  return (
    <div className="grid">
      <div className="field"><label>النوع</label>
        <select value={value.body_type} onChange={(e) => onChange({ ...value, body_type: e.target.value as BodyType })}>
          {Object.entries(BODY_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></div>
      <div className="field"><label>الاسم</label>
        <input required minLength={2} value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} /></div>
      <div className="field"><label>الاجتماعات في السنة</label>
        <input type="number" min={0} max={52} value={value.meetings_per_year ?? ""}
               onChange={(e) => onChange({ ...value, meetings_per_year: e.target.value === "" ? null : Number(e.target.value) })} /></div>
      <div className="field field-wide"><label>المهام والاختصاصات</label>
        <textarea rows={2} value={value.mandate ?? ""} onChange={(e) => onChange({ ...value, mandate: e.target.value || null })} /></div>
    </div>
  );
}

function AddBody({ busy, onAdd }: { busy: boolean; onAdd: (b: BodyInput) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<BodyInput>({ body_type: "OTHER_COMMITTEE", name: "", mandate: null, meetings_per_year: null });
  if (!open) return <button className="btn btn-quiet add-body" type="button" onClick={() => setOpen(true)}>+ إضافة جهاز أو لجنة</button>;
  return (
    <form className="panel inline-form" onSubmit={(e) => { e.preventDefault(); onAdd(v).then(() => { setOpen(false); setV({ ...v, name: "", mandate: null }); }); }}>
      <h3>جهاز أو لجنة جديدة</h3>
      <BodyFields value={v} onChange={(n) => setV({ ...n, name: n.name || (n.body_type !== v.body_type ? BODY_TYPE_LABEL[n.body_type] : n.name) })} />
      <div className="actions">
        <button className="btn btn-action" type="submit" disabled={busy}>إضافة</button>
        <button className="btn btn-quiet" type="button" onClick={() => setOpen(false)}>إلغاء</button>
      </div>
    </form>
  );
}

function MemberForm({ initial, busy, onSave, onCancel }: {
  initial: MemberInput; busy: boolean; onSave: (v: MemberInput) => Promise<void>; onCancel: () => void;
}) {
  const [v, setV] = useState<MemberInput>({ ...initial });
  return (
    <form className="inline-form member-form" onSubmit={(e) => { e.preventDefault(); onSave(v); }}>
      <div className="grid">
        <div className="field"><label>الاسم الكامل</label>
          <input required minLength={2} value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} /></div>
        <div className="field"><label>الصفة</label>
          <select value={v.position} onChange={(e) => setV({ ...v, position: e.target.value as MemberPosition })}>
            {Object.entries(POSITION_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></div>
        <div className="field"><label>تاريخ التعيين</label>
          <input type="date" value={v.appointed_on ?? ""} onChange={(e) => setV({ ...v, appointed_on: e.target.value || null })} /></div>
        <div className="field"><label>انتهاء العضوية</label>
          <input type="date" value={v.term_ends_on ?? ""} onChange={(e) => setV({ ...v, term_ends_on: e.target.value || null })} /></div>
      </div>
      <fieldset className="checks">
        <legend className="sr-only">التصنيف</legend>
        <label><input type="radio" name="cls" checked={!v.is_executive && !v.is_independent}
                      onChange={() => setV({ ...v, is_executive: false, is_independent: false })} /> غير تنفيذي</label>
        <label><input type="radio" name="cls" checked={v.is_independent}
                      onChange={() => setV({ ...v, is_executive: false, is_independent: true })} /> مستقل</label>
        <label><input type="radio" name="cls" checked={v.is_executive}
                      onChange={() => setV({ ...v, is_executive: true, is_independent: false })} /> تنفيذي</label>
      </fieldset>
      <div className="actions">
        <button className="btn btn-action" type="submit" disabled={busy}>حفظ</button>
        <button className="btn btn-quiet" type="button" onClick={onCancel}>إلغاء</button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ ملف الحوكمة
function ProfileForm({ profile, busy, onSave }: { profile: GovernanceProfile; busy: boolean; onSave: (p: GovernanceProfile) => Promise<void> }) {
  const [p, setP] = useState<GovernanceProfile>(profile);
  useEffect(() => setP(profile), [profile]);
  const d = (k: keyof GovernanceProfile) => ({
    type: "date" as const, value: (p[k] as string | null) ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, [k]: e.target.value || null }),
  });
  return (
    <section className="gov-section">
      <div className="section-head">
        <h2>ملف الحوكمة</h2>
        <p className="muted">هذه البيانات تحدد الالتزامات المنطبقة على منشأتك وتدخل في الفحص.</p>
      </div>
      <form className="panel profile-form" onSubmit={(e) => { e.preventDefault(); onSave(p); }}>
        <div className="grid">
          <div className="field"><label htmlFor="emp">عدد الموظفين</label>
            <input id="emp" type="number" min={0} value={p.employees_count ?? ""}
                   onChange={(e) => setP({ ...p, employees_count: e.target.value === "" ? null : Number(e.target.value) })} /></div>
          <div className="field"><label htmlFor="fy">شهر نهاية السنة المالية</label>
            <select id="fy" value={p.fiscal_year_end_month} onChange={(e) => setP({ ...p, fiscal_year_end_month: Number(e.target.value) })}>
              {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
            </select></div>
          <div className="field"><label htmlFor="vat">ضريبة القيمة المضافة</label>
            <select id="vat" value={p.vat_registered === null ? "" : String(p.vat_registered)}
                    onChange={(e) => setP({ ...p, vat_registered: e.target.value === "" ? null : e.target.value === "true" })}>
              <option value="">غير محدد</option><option value="true">مسجلة</option><option value="false">غير مسجلة</option>
            </select></div>
          <div className="field"><label htmlFor="aud">مراجع الحسابات</label>
            <input id="aud" value={p.auditor_name ?? ""} placeholder="اسم المكتب" onChange={(e) => setP({ ...p, auditor_name: e.target.value || null })} /></div>
          <div className="field"><label>آخر جمعية عامة / اجتماع شركاء</label><input {...d("last_assembly_on")} /></div>
          <div className="field"><label>آخر إيداع للقوائم المالية</label><input {...d("last_fs_filed_on")} /></div>
          <div className="field"><label>الإفصاح عن المستفيد الحقيقي</label><input {...d("beneficial_owners_filed_on")} /></div>
          <div className="field"><label>آخر تحديث لعقد التأسيس</label><input {...d("bylaws_updated_on")} /></div>
        </div>
        <div className="checks">
          <label><input type="checkbox" checked={p.has_bylaws} onChange={(e) => setP({ ...p, has_bylaws: e.target.checked })} />
            عقد التأسيس / النظام الأساس موثق ومتوافق مع نظام الشركات</label>
          <label><input type="checkbox" checked={p.processes_personal_data} onChange={(e) => setP({ ...p, processes_personal_data: e.target.checked })} />
            المنشأة تجمع أو تعالج بيانات شخصية (عملاء، موظفون، مستخدمون)</label>
        </div>
        <div className="actions"><button className="btn btn-action" type="submit" disabled={busy}>حفظ وإعادة الفحص</button></div>
      </form>
    </section>
  );
}
