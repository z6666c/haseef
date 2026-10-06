"use client";

import { useCallback, useEffect, useState } from "react";
import {
  GOV_DOMAIN_LABEL, LEGAL_TYPE_LABEL, LEVEL_LABEL, LIBRARY_CATEGORY_LABEL, LIBRARY_KIND_LABEL,
  OBLIGATION_DOMAIN_LABEL, OBLIGATION_KIND_LABEL, REVIEW_BADGE, fileSize,
  type AdminLibraryDoc, type AdminObligation, type AdminStandard, type GosiRate,
} from "@haseef/shared";
import { Dialog, useCan } from "@/components/ui";
import { api } from "@/lib/session";

type Tab = "library" | "obligations" | "standards" | "gosi";

export default function ContentPage() {
  const can = useCan();
  const [tab, setTab] = useState<Tab>("library");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editor = can("content.manage");
  const approver = can("content.approve");

  async function act(fn: () => Promise<unknown>, ok: string, reload: () => void) {
    setError(null); setNotice(null);
    try { await fn(); setNotice(ok); reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "تعذّر التنفيذ"); }
  }

  return (
    <>
      <h1>المحتوى المرجعي</h1>
      <p className="muted">ما يراه العملاء من مكتبة ومعايير والتزامات. كل عنصر يظهر للعملاء افتراضياً بشارة «{REVIEW_BADGE}» حتى يعتمده من يملك صلاحية الاعتماد. الإخفاء لا يحذف.</p>
      <div className="filters" role="tablist">
        {([["library", "المكتبة المرجعية"], ["obligations", "الالتزامات والسياسات المطلوبة"], ["standards", "معايير الحوكمة"], ["gosi", "نسب التأمينات الاجتماعية"]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {!editor && <p className="hint">التعديل يتطلب صلاحية إدارة المحتوى.</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {tab === "library" && <LibraryTab editor={editor} approver={approver} act={act} />}
      {tab === "obligations" && <ObligationsTab editor={editor} approver={approver} act={act} />}
      {tab === "standards" && <StandardsTab editor={editor} approver={approver} act={act} />}
      {tab === "gosi" && <GosiRatesTab editor={editor} act={act} />}
    </>
  );
}

type Act = (fn: () => Promise<unknown>, ok: string, reload: () => void) => Promise<void>;

function Toggles({ visible, review, editor, approver, onVisible, onReview }: {
  visible: boolean; review: string; editor: boolean; approver: boolean;
  onVisible: (v: boolean) => void; onReview: (r: "DRAFT" | "APPROVED") => void;
}) {
  return (
    <div className="row-actions-cell">
      <span className="pill" data-tone={visible ? "good" : undefined}>{visible ? "ظاهر" : "مخفي"}</span>
      {review === "DRAFT" ? <span className="draft-badge">{REVIEW_BADGE}</span> : <span className="pill" data-tone="good">معتمد</span>}
      {editor && <button className="link-btn" type="button" onClick={() => onVisible(!visible)}>{visible ? "إخفاء" : "إظهار"}</button>}
      {approver && <button className="link-btn" type="button" onClick={() => onReview(review === "DRAFT" ? "APPROVED" : "DRAFT")}>
        {review === "DRAFT" ? "اعتماد" : "إعادة لمسودة"}</button>}
    </div>
  );
}

// ------------------------------------------------------------------ المكتبة
function LibraryTab({ editor, approver, act }: { editor: boolean; approver: boolean; act: Act }) {
  const [rows, setRows] = useState<AdminLibraryDoc[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState<(AdminLibraryDoc & { body_md: string | null }) | null>(null);
  const load = useCallback(() => { api.admin.libraryAll().then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);

  async function download(d: AdminLibraryDoc) {
    const blob = await api.admin.libraryFile(d.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = d.file_name ?? "file"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  if (!rows) return null;
  return (
    <>
      {editor && <div className="head-row"><span /><button className="btn btn-action" type="button" onClick={() => setAdding(true)}>إضافة مستند أو رفع ملف</button></div>}
      <table className="table">
        <thead><tr><th>المستند</th><th>النوع</th><th>التصنيف</th><th>تبنّته منشآت</th><th><span className="sr-only">الحالة</span></th></tr></thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id}>
              <td>
                <strong>{d.title}</strong>
                {d.summary && <div className="muted small">{d.summary}</div>}
                <div className="small">
                  {d.kind === "LAW" && d.url && <a href={d.url} target="_blank" rel="noopener noreferrer">{d.url}</a>}
                  {d.kind === "FILE" && <button className="link-btn" type="button" onClick={() => download(d)}>{d.file_name} ({fileSize(d.file_size)})</button>}
                  {(d.kind === "TEMPLATE" || d.kind === "GUIDE") && editor && (
                    <button className="link-btn" type="button" onClick={() => api.admin.libraryDoc(d.id).then(setEdit)}>تعديل النص</button>)}
                </div>
              </td>
              <td>{LIBRARY_KIND_LABEL[d.kind]}</td>
              <td>{LIBRARY_CATEGORY_LABEL[d.category] ?? d.category}</td>
              <td className="num">{d.adoptions}</td>
              <td>
                <Toggles visible={d.is_visible} review={d.review_status} editor={editor} approver={approver}
                         onVisible={(v) => act(() => api.admin.patchDoc(d.id, { is_visible: v }), v ? "أصبح ظاهراً للعملاء" : "أُخفي عن العملاء", load)}
                         onReview={(r) => act(() => api.admin.patchDoc(d.id, { review_status: r }), r === "APPROVED" ? "اعتُمد المستند" : "أُعيد لمسودة", load)} />
                {approver && <button className="link-btn danger" type="button"
                  onClick={() => { if (window.confirm(`حذف «${d.title}» نهائياً؟ الإخفاء يكفي غالباً.`)) act(() => api.admin.deleteDoc(d.id), "حُذف المستند", load); }}>حذف</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <AddDocDialog open={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />
      <Dialog open={!!edit} title={edit?.title ?? ""} onClose={() => setEdit(null)}>
        {edit && <EditText doc={edit} onSave={(body) => act(() => api.admin.patchDoc(edit.id, { body_md: body }), "حُفظ النص", () => { setEdit(null); load(); })} />}
      </Dialog>
    </>
  );
}

function EditText({ doc, onSave }: { doc: { body_md: string | null }; onSave: (b: string) => void }) {
  const [v, setV] = useState(doc.body_md ?? "");
  return (
    <form className="dialog-body" onSubmit={(e) => { e.preventDefault(); onSave(v); }}>
      <textarea className="md-editor" rows={20} value={v} onChange={(e) => setV(e.target.value)} />
      <div className="dialog-actions"><button className="btn btn-action" type="submit">حفظ</button></div>
    </form>
  );
}

function AddDocDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ kind: "FILE", category: "POLICIES", title: "", summary: "", url: "", body_md: "", applies: [] as string[] });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const body: Record<string, unknown> = { kind: f.kind, category: f.category, title: f.title, summary: f.summary || null,
                                              applies_legal_types: f.applies };
      if (f.kind === "LAW") body.url = f.url;
      if (f.kind === "TEMPLATE" || f.kind === "GUIDE") body.body_md = f.body_md;
      if (f.kind === "FILE") {
        if (!file) throw new Error("اختر ملفاً");
        const b64 = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result).split(",")[1] ?? "");
          r.onerror = () => rej(new Error("تعذّرت قراءة الملف"));
          r.readAsDataURL(file);
        });
        Object.assign(body, { file_name: file.name, file_mime: file.type, file_base64: b64 });
      }
      await api.admin.createDoc(body);
      setF({ ...f, title: "", summary: "", url: "", body_md: "" }); setFile(null);
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : "تعذّرت الإضافة"); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open={open} title="إضافة إلى المكتبة المرجعية" onClose={onClose}>
      <form className="dialog-body" onSubmit={submit}>
        <div className="field"><label>النوع</label>
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="FILE">ملف (PDF، Word، Excel…)</option><option value="LAW">رابط نظام أو جهة رسمية</option>
            <option value="TEMPLATE">نموذج نصي</option><option value="GUIDE">دليل نصي</option>
          </select></div>
        <div className="field"><label>التصنيف</label>
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {Object.entries(LIBRARY_CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div className="field"><label>العنوان</label><input required minLength={3} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div className="field"><label>وصف مختصر</label><input value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></div>
        {f.kind === "FILE" && <div className="field"><label>الملف (حتى 15 ميجابايت)</label>
          <input type="file" required accept=".pdf,.doc,.docx,.xls,.xlsx,.pptx,.txt,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>}
        {f.kind === "LAW" && <div className="field"><label>الرابط الرسمي</label><input required dir="ltr" pattern="https://.*" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></div>}
        {(f.kind === "TEMPLATE" || f.kind === "GUIDE") && <div className="field"><label>النص (# عنوان، - قائمة، | جدول)</label>
          <textarea className="md-editor" rows={10} required value={f.body_md} onChange={(e) => setF({ ...f, body_md: e.target.value })} /></div>}
        <fieldset className="field"><legend className="small">يناسب الكيانات (اتركها فارغة للكل)</legend>
          <div className="role-legend">{Object.entries(LEGAL_TYPE_LABEL).map(([k, v]) => (
            <label key={k} className="small"><input type="checkbox" checked={f.applies.includes(k)}
              onChange={(e) => setF({ ...f, applies: e.target.checked ? [...f.applies, k] : f.applies.filter((x) => x !== k) })} /> {v}</label>))}</div>
        </fieldset>
        <p className="hint">يظهر للعملاء فوراً بشارة «{REVIEW_BADGE}». يمكنك إخفاؤه لاحقاً.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dialog-actions"><button className="btn btn-action" type="submit" disabled={busy}>{busy ? "جارٍ الرفع…" : "إضافة"}</button></div>
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------------ الالتزامات
function ObligationsTab({ editor, approver, act }: { editor: boolean; approver: boolean; act: Act }) {
  const [rows, setRows] = useState<AdminObligation[] | null>(null);
  const load = useCallback(() => { api.admin.catalogObligations().then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);
  if (!rows) return null;
  return (
    <table className="table">
      <thead><tr><th>الالتزام</th><th>المجال</th><th>النوع</th><th>ينطبق على</th><th className="num">منشآت</th><th><span className="sr-only">الحالة</span></th></tr></thead>
      <tbody>
        {rows.map((o) => (
          <tr key={o.code}>
            <td><strong>{o.title}</strong><div className="muted small">{o.authority ?? ""}{o.legal_reference ? ` · ${o.legal_reference}` : ""}</div></td>
            <td>{OBLIGATION_DOMAIN_LABEL[o.domain] ?? o.domain}</td>
            <td>{OBLIGATION_KIND_LABEL[o.kind] ?? o.kind}</td>
            <td className="small">{describeApplies(o.applies)}</td>
            <td className="num">{o.orgs}</td>
            <td><Toggles visible={o.is_visible} review={o.review_status} editor={editor} approver={approver}
                         onVisible={(v) => act(() => api.admin.patchObligation(o.code, { is_visible: v }), v ? "أصبح ظاهراً" : "أُخفي", load)}
                         onReview={(r) => act(() => api.admin.patchObligation(o.code, { review_status: r }), r === "APPROVED" ? "اعتُمد" : "أُعيد لمسودة", load)} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function describeApplies(a: Record<string, unknown>): string {
  const parts: string[] = [];
  const lts = a.legal_types as string[] | undefined;
  parts.push(lts?.length ? lts.map((t) => LEGAL_TYPE_LABEL[t] ?? t).join("، ") : "كل الكيانات");
  if (a.min_employees) parts.push(`${a.min_employees}+ موظف`);
  if (a.personal_data) parts.push("تعالج بيانات شخصية");
  if (a.vat) parts.push("مسجلة في الضريبة");
  if (Array.isArray(a.industries)) parts.push("أنشطة محددة");
  return parts.join(" · ");
}

// ------------------------------------------------------------------ المعايير
function StandardsTab({ editor, approver, act }: { editor: boolean; approver: boolean; act: Act }) {
  const [rows, setRows] = useState<AdminStandard[] | null>(null);
  const load = useCallback(() => { api.admin.standards().then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);
  if (!rows) return null;
  return (
    <table className="table">
      <thead><tr><th>المعيار</th><th>المحور</th><th>المستوى</th><th>الكيانات</th><th><span className="sr-only">الحالة</span></th></tr></thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.code}>
            <td><strong>{s.title}</strong><div className="muted small">{s.description}</div>{s.legal_reference && <div className="small">{s.legal_reference}</div>}</td>
            <td>{GOV_DOMAIN_LABEL[s.domain] ?? s.domain}</td>
            <td>{LEVEL_LABEL[s.level]}</td>
            <td className="small">{s.applies_legal_types.length ? s.applies_legal_types.map((t) => LEGAL_TYPE_LABEL[t] ?? t).join("، ") : "الكل"}</td>
            <td><Toggles visible={s.is_visible} review={s.review_status} editor={editor} approver={approver}
                         onVisible={(v) => act(() => api.admin.patchStandard(s.code, { is_visible: v }), v ? "أصبح ظاهراً ويدخل في الفحص" : "أُخفي ولن يدخل في الفحص", load)}
                         onReview={(r) => act(() => api.admin.patchStandard(s.code, { review_status: r }), r === "APPROVED" ? "اعتُمد" : "أُعيد لمسودة", load)} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ------------------------------------------------------------------ نسب التأمينات
const GOSI_SYSTEM: Record<string, string> = { OLD: "السعوديون — النظام السابق", NEW: "السعوديون — النظام الجديد", NON_SAUDI: "غير السعوديين" };
const EMPTY_RATE: GosiRate = { system: "NEW", effective_from: "", employee_annuity: 11, employer_annuity: 11, employee_saned: 0.75, employer_saned: 0.75,
  employer_hazards: 2, min_base: 1500, max_base: 45000, note: "" };

function GosiRatesTab({ editor, act }: { editor: boolean; act: Act }) {
  const [rows, setRows] = useState<(GosiRate & { id: number; updated_at: string })[] | null>(null);
  const [edit, setEdit] = useState<GosiRate | null>(null);
  const load = useCallback(() => { api.admin.gosiRates().then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);
  if (!rows) return null;
  const num = (k: keyof GosiRate, label: string) => edit && (
    <div className="field"><label>{label}</label><input type="number" step="0.01" min={0} required value={edit[k] as number}
      onChange={(e) => setEdit({ ...edit, [k]: Number(e.target.value) })} /></div>);
  return (
    <>
      <p className="muted">تُستخدم في حاسبة العملاء ومبالغ مهام السداد الشهرية. عند صدور تعديل نظامي أضف صفاً بتاريخ سريانه، والحساب يختار الأحدث السارية لكل شهر.</p>
      {editor && <p><button className="btn" type="button" onClick={() => setEdit({ ...EMPTY_RATE })}>+ نسبة بتاريخ سريان</button></p>}
      <table className="table">
        <thead><tr><th>الفئة</th><th>يسري من</th><th>الموظف (معاشات + ساند)</th><th>المنشأة (معاشات + ساند + أخطار)</th><th>الأجر الخاضع</th><th><span className="sr-only">إجراء</span></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{GOSI_SYSTEM[r.system]}{r.note && <div className="muted small">{r.note}</div>}</td>
              <td>{r.effective_from}</td>
              <td>{r.employee_annuity}% + {r.employee_saned}% = <b>{+(r.employee_annuity + r.employee_saned).toFixed(2)}%</b></td>
              <td>{r.employer_annuity}% + {r.employer_saned}% + {r.employer_hazards}% = <b>{+(r.employer_annuity + r.employer_saned + r.employer_hazards).toFixed(2)}%</b></td>
              <td className="small">{r.min_base.toLocaleString("en-US")} – {r.max_base.toLocaleString("en-US")}</td>
              <td>{editor && <button className="link-btn" type="button" onClick={() => setEdit({ ...r })}>تعديل</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Dialog open={!!edit} title="نسبة التأمينات" onClose={() => setEdit(null)}>
        {edit && (
          <form onSubmit={(e) => { e.preventDefault(); act(() => api.admin.setGosiRate(edit), "حُفظت النسبة", load).then(() => setEdit(null)); }}>
            <div className="grid">
              <div className="field"><label>الفئة</label><select value={edit.system} onChange={(e) => setEdit({ ...edit, system: e.target.value as GosiRate["system"] })}>
                {Object.entries(GOSI_SYSTEM).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              <div className="field"><label>يسري من</label><input type="date" required value={edit.effective_from} onChange={(e) => setEdit({ ...edit, effective_from: e.target.value })} /></div>
              {num("employee_annuity", "معاشات — الموظف %")}{num("employer_annuity", "معاشات — المنشأة %")}
              {num("employee_saned", "ساند — الموظف %")}{num("employer_saned", "ساند — المنشأة %")}
              {num("employer_hazards", "أخطار مهنية — المنشأة %")}{num("min_base", "الحد الأدنى للأجر")}{num("max_base", "الحد الأعلى للأجر")}
              <div className="field"><label>ملاحظة</label><input value={edit.note ?? ""} maxLength={300} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></div>
            </div>
            <div className="dialog-actions"><button className="btn" type="submit">حفظ</button>
              <button className="btn btn-quiet" type="button" onClick={() => setEdit(null)}>إلغاء</button></div>
          </form>
        )}
      </Dialog>
    </>
  );
}
