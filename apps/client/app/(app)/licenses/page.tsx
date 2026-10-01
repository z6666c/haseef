"use client";

import { useCallback, useEffect, useState } from "react";
import { CATEGORY_LABEL, RISK_LABEL, type ComplianceCategory, type ComplianceItem, type RiskLevel } from "@haseef/shared";
import { ItemRow } from "@/components/ItemRow";
import { api } from "@/lib/session";

// الخطورة الافتراضية حسب نوع الترخيص: انتهاء السجل التجاري يوقف المنشأة، فهو حرج.
const DEFAULT_RISK: Partial<Record<ComplianceCategory, RiskLevel>> = {
  COMMERCIAL_REG: "CRITICAL", BALADY: "CRITICAL", CHI_INSURANCE: "HIGH", GOSI: "HIGH",
  QIWA_NITAQAT: "HIGH", WPS: "HIGH", ZATCA: "HIGH", CIVIL_DEFENSE: "HIGH", CHAMBER: "MEDIUM",
};

const EMPTY = { category: "COMMERCIAL_REG" as ComplianceCategory, title: "", reference_number: "",
                expiry_date: "", risk_level: "CRITICAL" as RiskLevel };

export default function LicensesPage() {
  const [items, setItems] = useState<ComplianceItem[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.listItems().then(setItems).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  function pickCategory(category: ComplianceCategory) {
    setForm((f) => ({
      ...f, category,
      risk_level: DEFAULT_RISK[category] ?? "MEDIUM",
      title: f.title && f.title !== CATEGORY_LABEL[f.category] ? f.title : CATEGORY_LABEL[category],
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createItem({ ...form, reference_number: form.reference_number || null });
      setForm(EMPTY);
      setAdding(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر حفظ الترخيص");
    } finally {
      setBusy(false);
    }
  }

  async function renew(item: ComplianceItem, date: string) {
    await api.renewItem(item.id, date);
    load();
  }

  return (
    <>
      <header className="page-head page-head-row">
        <div>
          <h1>التراخيص والالتزامات</h1>
          <p className="muted">مرتبة حسب أقرب تاريخ انتهاء. تصلك التنبيهات قبل 60 و30 و14 و7 و3 أيام ويوم واحد.</p>
        </div>
        {!adding && <button className="btn" type="button" onClick={() => { setForm({ ...EMPTY, title: CATEGORY_LABEL.COMMERCIAL_REG }); setAdding(true); }}>أضف ترخيصاً</button>}
      </header>

      {adding && (
        <form className="panel add-form" onSubmit={submit}>
          <h2>ترخيص جديد</h2>
          <div className="grid">
            <div className="field">
              <label htmlFor="category">النوع</label>
              <select id="category" value={form.category} onChange={(e) => pickCategory(e.target.value as ComplianceCategory)}>
                {(Object.keys(CATEGORY_LABEL) as ComplianceCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="title">الاسم كما تريد أن يظهر في التنبيه</label>
              <input id="title" required minLength={2} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="ref">الرقم المرجعي (اختياري)</label>
              <input id="ref" dir="ltr" value={form.reference_number} onChange={(e) => setForm({ ...form, reference_number: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="expiry">تاريخ الانتهاء</label>
              <input id="expiry" type="date" required value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="risk">الخطورة عند الانتهاء</label>
              <select id="risk" value={form.risk_level} onChange={(e) => setForm({ ...form, risk_level: e.target.value as RiskLevel })}>
                {(Object.keys(RISK_LABEL) as RiskLevel[]).map((r) => <option key={r} value={r}>{RISK_LABEL[r]}</option>)}
              </select>
            </div>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="actions">
            <button className="btn" type="submit" disabled={busy}>{busy ? "جارٍ الحفظ…" : "احفظ الترخيص"}</button>
            <button className="btn btn-quiet" type="button" onClick={() => setAdding(false)}>إلغاء</button>
          </div>
        </form>
      )}

      {!items ? (
        <div className="boot" aria-busy="true" />
      ) : items.length === 0 ? (
        <div className="panel ledger-empty">
          <p>ابدأ بالسجل التجاري ورخصة بلدي: انتهاؤهما يوقف خدمات المنشأة لدى الجهات الحكومية.</p>
        </div>
      ) : (
        <ol className="rows rows-full">
          {items.map((it) => <ItemRow key={it.id} item={it} onRenew={renew} />)}
        </ol>
      )}
    </>
  );
}
