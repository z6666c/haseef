"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { POLICY_STATUS_LABEL, POLICY_TYPE_LABEL, type Policy } from "@haseef/shared";
import { api } from "@/lib/session";

function fmt(d: string | null) {
  return d ? new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { dateStyle: "medium" }).format(new Date(d)) : "—";
}

export default function PoliciesPage() {
  const [rows, setRows] = useState<Policy[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.policies().then(setRows).catch((e: Error) => setError(e.message)); }, []);

  if (!rows) return error ? <p className="error" role="alert">{error}</p> : <div className="boot" aria-busy="true" />;
  return (
    <>
      <header className="page-head page-head-row">
        <div>
          <h1>السياسات الداخلية</h1>
          <p className="muted">سياسات منشأتك وحالة اعتمادها وموعد مراجعتها. تصلك التنبيهات قبل موعد المراجعة.</p>
        </div>
        <Link className="btn btn-action" href="/library">أضف من نماذج المكتبة</Link>
      </header>
      {rows.length === 0 ? (
        <div className="ledger-empty">
          <p>لا توجد سياسات بعد. ابدأ من نموذج جاهز في المكتبة المرجعية وكيّفه لمنشأتك.</p>
          <Link className="btn btn-action" href="/library">تصفح النماذج</Link>
        </div>
      ) : (
        <table className="deadlines">
          <thead><tr><th>السياسة</th><th>النوع</th><th>الحالة</th><th>الاعتماد</th><th>المراجعة القادمة</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td><Link href={`/policies/view?id=${p.id}`}><strong>{p.title}</strong></Link> <span className="muted small">إصدار {p.version}</span></td>
                <td>{POLICY_TYPE_LABEL[p.policy_type] ?? p.policy_type}</td>
                <td><span className="status-chip" data-s={p.effective_status}>{POLICY_STATUS_LABEL[p.effective_status] ?? p.effective_status}</span></td>
                <td>{fmt(p.approval_date)}</td>
                <td>{fmt(p.review_due_date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
