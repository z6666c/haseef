"use client";

import { useCallback, useEffect, useState } from "react";
import { INTEREST_LABEL, LEGAL_TYPE_LABEL, PLAN_LABEL, TRIAL_STATUS_LABEL, type TrialRequest } from "@haseef/shared";
import { fmtDateTime } from "@/components/ui";
import { api } from "@/lib/session";

const TONE: Record<string, string> = { NEW: "PENDING", CONTACTED: "DRAFT", CONVERTED: "IN_PLACE", REJECTED: "FAIL" };

export default function TrialsPage() {
  const [rows, setRows] = useState<TrialRequest[] | null>(null);
  const [filter, setFilter] = useState<"ALL" | TrialRequest["status"]>("ALL");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => { api.admin.trials().then(setRows).catch((e: Error) => setError(e.message)); }, []);
  useEffect(load, [load]);

  async function setStatus(t: TrialRequest, status: TrialRequest["status"]) {
    const notes = window.prompt("ملاحظة المتابعة (اختياري):", t.notes ?? "");
    if (notes === null) return;
    setError(null); setNotice(null);
    try { await api.admin.updateTrial(t.id, { status, notes: notes.trim() || null }); setNotice(`حُدّث طلب ${t.company_name}`); load(); }
    catch (e) { setError(e instanceof Error ? e.message : "تعذّر التحديث"); }
  }

  if (!rows) return error ? <p className="error" role="alert">{error}</p> : <div className="boot" aria-busy="true" />;
  const shown = filter === "ALL" ? rows : rows.filter((r) => r.status === filter);
  const count = (s: string) => rows.filter((r) => r.status === s).length;

  return (
    <>
      <h1>طلبات التجربة</h1>
      <p className="muted">الطلبات الواردة من الصفحة التسويقية. تواصل خلال يوم عمل، ثم أنشئ المنشأة من «المنشآت» عند الموافقة.</p>
      <div className="filters" role="tablist">
        {(["ALL", "NEW", "CONTACTED", "CONVERTED", "REJECTED"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {k === "ALL" ? `الكل (${rows.length})` : `${TRIAL_STATUS_LABEL[k]} (${count(k)})`}
          </button>
        ))}
      </div>
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {shown.length === 0 ? <p className="empty">لا طلبات.</p> : (
        <table className="table">
          <thead><tr><th>المنشأة والمتقدم</th><th>التواصل</th><th>الاهتمام</th><th>الحالة</th><th>الوصول</th><th></th></tr></thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.id}>
                <td>
                  <strong>{t.company_name}</strong>
                  <div className="small muted">{t.full_name}{t.legal_type ? ` · ${LEGAL_TYPE_LABEL[t.legal_type] ?? "أخرى"}` : ""}{t.employees_range ? ` · ${t.employees_range} موظف` : ""}</div>
                  {t.message && <div className="small">{t.message}</div>}
                </td>
                <td className="small"><a href={`mailto:${t.email}`} dir="ltr">{t.email}</a>{t.phone_number && <div dir="ltr">{t.phone_number}</div>}</td>
                <td className="small">
                  {PLAN_LABEL[t.plan_interest] ?? "لم يحدد الباقة"}
                  {t.interests.length > 0 && <div className="muted">{t.interests.map((i) => INTEREST_LABEL[i] ?? i).join("، ")}</div>}
                </td>
                <td>
                  <span className="status-chip" data-s={TONE[t.status]}>{TRIAL_STATUS_LABEL[t.status]}</span>
                  {t.notes && <div className="small muted">{t.notes}</div>}
                  {t.handled_by_name && <div className="small muted">بواسطة {t.handled_by_name}</div>}
                </td>
                <td className="small">{fmtDateTime(t.created_at)}</td>
                <td className="row-actions-cell">
                  {t.status !== "CONTACTED" && <button className="link-btn" type="button" onClick={() => setStatus(t, "CONTACTED")}>تم التواصل</button>}
                  {t.status !== "CONVERTED" && <button className="link-btn" type="button" onClick={() => setStatus(t, "CONVERTED")}>أصبح عميلاً</button>}
                  {t.status !== "REJECTED" && <button className="link-btn danger" type="button" onClick={() => setStatus(t, "REJECTED")}>غير مناسب</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
