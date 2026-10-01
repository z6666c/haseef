"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FREQUENCY_LABEL, OBLIGATION_DOMAIN_LABEL, OBLIGATION_KIND_LABEL, OBLIGATION_STATUS_LABEL, REVIEW_BADGE, RISK_LABEL,
  type Obligation, type ObligationStatus,
} from "@haseef/shared";
import { api } from "@/lib/session";

type Filter = "OPEN" | "ALL" | "DONE";

export default function ObligationsPage() {
  const [rows, setRows] = useState<Obligation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("OPEN");
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(() => { api.obligations().then(setRows).catch((e: Error) => setError(e.message)); }, []);
  useEffect(load, [load]);

  const groups = useMemo(() => {
    const shown = (rows ?? []).filter((o) =>
      filter === "ALL" ? true : filter === "DONE" ? o.effective_status === "IN_PLACE" || o.effective_status === "NOT_APPLICABLE"
        : o.effective_status === "PENDING" || o.effective_status === "AT_RISK");
    const g: Record<string, Obligation[]> = {};
    for (const o of shown) (g[o.domain] ??= []).push(o);
    return Object.entries(g);
  }, [rows, filter]);

  async function setStatus(o: Obligation, status: ObligationStatus) {
    setSaving(o.code); setError(null);
    try { await api.setObligation(o.code, status, o.note); load(); }
    catch (e) { setError(e instanceof Error ? e.message : "تعذّر الحفظ"); }
    finally { setSaving(null); }
  }

  if (!rows) return error ? <p className="error" role="alert">{error}</p> : <div className="boot" aria-busy="true" />;
  const open = rows.filter((o) => o.effective_status === "PENDING" || o.effective_status === "AT_RISK").length;
  const done = rows.filter((o) => o.effective_status === "IN_PLACE").length;
  const confirm = rows.some((o) => o.needs_confirmation);

  return (
    <>
      <header className="page-head">
        <h1>الالتزامات النظامية</h1>
        <p className="muted">
          ما ينطبق على منشأتك حسب كيانها وحجمها وعدد موظفيها ونشاطها. ما تتابعه في حصيف من تراخيص وسياسات يُحتسب مستوفى تلقائياً.
        </p>
      </header>

      <dl className="obl-stats">
        <div><dt>إجمالي المنطبق</dt><dd>{rows.length}</dd></div>
        <div><dt>مستوفى</dt><dd data-s="IN_PLACE">{done}</dd></div>
        <div><dt>بحاجة لإجراء</dt><dd data-s="PENDING">{open}</dd></div>
      </dl>

      {confirm && (
        <p className="hint-box">بعض الالتزامات تعتمد على عدد الموظفين أو التسجيل في ضريبة القيمة المضافة. أكمل
          {" "}<Link href="/governance">ملف الحوكمة</Link> لتصبح القائمة أدق.</p>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      <div className="filters" role="group" aria-label="تصفية">
        {(["OPEN", "DONE", "ALL"] as Filter[]).map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === "OPEN" ? "بحاجة لإجراء" : f === "DONE" ? "مستوفى أو لا ينطبق" : "الكل"}
          </button>
        ))}
      </div>

      {groups.length === 0 && <p className="empty">لا عناصر في هذا العرض.</p>}
      {groups.map(([domain, items]) => (
        <section key={domain} className="obl-group">
          <h2>{OBLIGATION_DOMAIN_LABEL[domain] ?? domain}</h2>
          <ul className="obl-list">
            {items.map((o) => (
              <li key={o.code} data-s={o.effective_status}>
                <div className="obl-main">
                  <div className="res-head">
                    <strong>{o.title}</strong>
                    <span className="tag">{OBLIGATION_KIND_LABEL[o.kind]}</span>
                    <span className="tag tag-quiet">{FREQUENCY_LABEL[o.frequency]}</span>
                    <span className="risk" data-r={o.risk_level}>{RISK_LABEL[o.risk_level]}</span>
                    {o.review_status === "DRAFT" && <span className="draft-badge">{REVIEW_BADGE}</span>}
                  </div>
                  <p>{o.description}</p>
                  <p className="small muted">
                    {o.authority && <>الجهة: {o.authority}</>}
                    {o.legal_reference && <> · المرجع: {o.source_url
                      ? <a href={o.source_url} target="_blank" rel="noopener noreferrer">{o.legal_reference}</a> : o.legal_reference}</>}
                  </p>
                  {o.tracked?.type === "ITEM" && (
                    <p className="small tracked">يتابعه حصيف: {o.tracked.title}{o.tracked.status === "EXPIRED" ? " — منتهٍ، جدّده" : ""}</p>
                  )}
                  {o.tracked?.type === "POLICY" && <p className="small tracked">سياسة معتمدة لديك في حصيف.</p>}
                  {o.needs_confirmation && <p className="small muted">ينطبق مبدئياً — أكّد بيانات منشأتك في ملف الحوكمة.</p>}
                  {o.effective_status !== "IN_PLACE" && !o.tracked && (
                    <p className="obl-next">
                      {o.compliance_category && <Link href="/licenses?new=1">تابعه كترخيص بتاريخ انتهاء ←</Link>}
                      {o.policy_type && <Link href={`/library?type=${o.policy_type}`}>استخدم نموذج السياسة من المكتبة ←</Link>}
                    </p>
                  )}
                </div>
                <div className="obl-status">
                  <span className="status-chip" data-s={o.effective_status}>{OBLIGATION_STATUS_LABEL[o.effective_status]}</span>
                  {!o.tracked && (
                    <select aria-label={`حالة ${o.title}`} value={o.status} disabled={saving === o.code}
                            onChange={(e) => setStatus(o, e.target.value as ObligationStatus)}>
                      <option value="PENDING">لم يُستوفَ بعد</option>
                      <option value="IN_PLACE">مستوفى</option>
                      <option value="NOT_APPLICABLE">لا ينطبق علينا</option>
                    </select>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
