"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BILLING_STATUS_LABEL, PLAN_LABEL, formatDate, type AdminOrg } from "@haseef/shared";
import { useCan } from "@/components/ui";
import { api } from "@/lib/session";

export default function Organizations() {
  const can = useCan();
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
        <div className="head-tools">
          <div className="field inline">
            <label htmlFor="q" className="sr-only">ابحث</label>
            <input id="q" type="search" placeholder="الاسم أو رقم السجل" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {can("SUPPORT") && <Link className="btn btn-action" href="/organizations/new">منشأة جديدة</Link>}
        </div>
      </div>
      <table className="table table-click">
        <thead>
          <tr><th>المنشأة</th><th>السجل التجاري</th><th>الباقة</th><th>الاشتراك</th><th className="num">الأعضاء</th><th className="num">المؤشر</th><th>انضمت</th></tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={`/organizations/${r.id}`} className="row-link">{r.name}</Link>
                {r.suspended_at && <span className="pill" data-tone="bad">معلّقة</span>}
                <div className="muted small">{r.industry_type ?? ""}</div>
              </td>
              <td><bdi dir="ltr">{r.cr_number}</bdi></td>
              <td>{r.plan_tier ? PLAN_LABEL[r.plan_tier] ?? r.plan_tier : <span className="muted">بلا اشتراك</span>}</td>
              <td>{r.billing_status ? BILLING_STATUS_LABEL[r.billing_status] ?? r.billing_status : "—"}
                {r.ends_at && <div className="muted small">حتى {formatDate(r.ends_at)}</div>}</td>
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
