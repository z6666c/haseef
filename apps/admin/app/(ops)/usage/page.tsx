"use client";

import { useEffect, useState } from "react";
import { PLAN_LABEL, type AdminUsage } from "@haseef/shared";
import { api } from "@/lib/session";

const n = (v: number, d = 0) => new Intl.NumberFormat("ar-SA-u-nu-latn", { maximumFractionDigits: d }).format(v);

export default function Usage() {
  const [rows, setRows] = useState<AdminUsage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.admin.aiUsage().then(setRows).catch((e: Error) => setError(e.message)); }, []);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!rows) return null;
  const showCost = rows.every((r) => r.cost_sar !== null);   // الدعم الفني لا يرى التكلفة
  const total = rows.reduce((s, r) => s + Number(r.cost_sar ?? 0), 0);

  return (
    <>
      <h1>استهلاك الذكاء الاصطناعي</h1>
      <p className="muted">{showCost ? <>هذا الشهر: تكلفة إجمالية {n(total, 2)} ريال. المنشآت مرتبة من الأعلى تكلفة.</> : "استهلاك هذا الشهر مقارنة بحصة كل باقة."}</p>
      <table className="table">
        <thead><tr><th>المنشأة</th><th>الباقة</th><th className="num">التدقيقات / الحصة</th><th className="num">التوكنز</th>{showCost && <th className="num">التكلفة (ريال)</th>}</tr></thead>
        <tbody>
          {rows.map((r) => {
            const over = r.quota !== null && r.audits_this_month >= r.quota;
            return (
              <tr key={r.org_id}>
                <td>{r.name}</td>
                <td>{r.plan_tier ? PLAN_LABEL[r.plan_tier] ?? r.plan_tier : "—"}</td>
                <td className="num">
                  <span className={over ? "pill" : undefined} data-tone={over ? "warn" : undefined}>
                    {r.audits_this_month} / {r.quota ?? "∞"}
                  </span>
                </td>
                <td className="num">{n(Number(r.tokens))}</td>
                {showCost && <td className="num">{n(Number(r.cost_sar), 2)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
