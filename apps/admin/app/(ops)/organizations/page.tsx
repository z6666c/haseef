"use client";

import { useEffect, useState } from "react";
import { PLAN_LABEL, formatDate, type AdminOrg } from "@haseef/shared";
import { api } from "@/lib/session";

const BILLING: Record<string, string> = { TRIAL: "تجريبي", ACTIVE: "فعّال", PAST_DUE: "متأخر السداد" };

export default function Organizations() {
  const [rows, setRows] = useState<AdminOrg[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.admin.organizations().then(setRows).catch((e: Error) => setError(e.message)); }, []);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!rows) return null;
  const shown = rows.filter((r) => !q || r.name.includes(q) || r.cr_number.includes(q));

  return (
    <>
      <div className="head-row">
        <h1>المنشآت <span className="muted">({rows.length})</span></h1>
        <div className="field inline">
          <label htmlFor="q" className="sr-only">ابحث</label>
          <input id="q" type="search" placeholder="الاسم أو رقم السجل" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <table className="table">
        <thead>
          <tr><th>المنشأة</th><th>السجل التجاري</th><th>الباقة</th><th>الاشتراك</th><th className="num">الأعضاء</th><th className="num">المؤشر</th><th>انضمت</th></tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id}>
              <td>{r.name}<div className="muted small">{r.industry_type ?? ""}</div></td>
              <td dir="ltr" className="mono-num">{r.cr_number}</td>
              <td>{r.plan_tier ? PLAN_LABEL[r.plan_tier] ?? r.plan_tier : <span className="muted">بلا اشتراك</span>}</td>
              <td>{r.billing_status ? BILLING[r.billing_status] ?? r.billing_status : "—"}{r.ends_at && <div className="muted small">حتى {formatDate(r.ends_at)}</div>}</td>
              <td className="num">{r.members}</td>
              <td className="num">{r.haseef_score ?? <span className="muted">غير مُقيَّم</span>}</td>
              <td>{formatDate(r.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length === 0 && <p className="muted">لا نتائج لـ «{q}».</p>}
    </>
  );
}
