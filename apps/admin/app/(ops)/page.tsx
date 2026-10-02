"use client";

import { useEffect, useState } from "react";
import { PLAN_LABEL, type AdminOverview } from "@haseef/shared";
import { api } from "@/lib/session";

const sar = (n: number) => new Intl.NumberFormat("ar-SA-u-nu-latn", { maximumFractionDigits: 0 }).format(n);

export default function Overview() {
  const [d, setD] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.admin.overview().then(setD).catch((e: Error) => setError(e.message)); }, []);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!d) return null;
  const k = d.kpis;
  const planTotal = d.by_plan.reduce((s, p) => s + p.n, 0) || 1;

  return (
    <>
      <h1>نظرة عامة</h1>
      <dl className="kpis">
        {k.mrr_sar !== null && <div><dt>الإيراد الشهري المتكرر</dt><dd>{sar(Number(k.mrr_sar))} <small>ريال</small></dd></div>}
        <div><dt>منشآت فعّالة</dt><dd>{k.active_orgs}</dd></div>
        <div><dt>في الفترة التجريبية</dt><dd>{k.trials}</dd></div>
        <div><dt>متوسط مؤشر حصافة</dt><dd>{k.avg_score ?? "—"}{k.avg_score !== null && <small>%</small>}</dd></div>
      </dl>

      <div className="split">
        <section>
          <h2>توزيع الباقات</h2>
          <ul className="bars">
            {d.by_plan.map((p) => (
              <li key={p.plan_tier}>
                <span>{PLAN_LABEL[p.plan_tier] ?? p.plan_tier}</span>
                <span className="bar"><span style={{ inlineSize: `${(100 * p.n) / planTotal}%` }} /></span>
                <span className="num">{p.n}</span>
              </li>
            ))}
            {d.by_plan.length === 0 && <li className="muted">لا اشتراكات بعد.</li>}
          </ul>
        </section>
        <section>
          <h2>أكثر القطاعات</h2>
          <table className="table">
            <thead><tr><th>القطاع</th><th className="num">المنشآت</th></tr></thead>
            <tbody>{d.by_industry.map((r) => <tr key={r.industry}><td>{r.industry}</td><td className="num">{r.n}</td></tr>)}</tbody>
          </table>
        </section>
      </div>
    </>
  );
}
