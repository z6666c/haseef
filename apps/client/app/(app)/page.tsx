"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PLAN_LABEL, type ComplianceItem, type Dashboard } from "@haseef/shared";
import { ItemRow } from "@/components/ItemRow";
import { ScoreSeal } from "@/components/ScoreSeal";
import { api } from "@/lib/session";

export default function RadarPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.dashboard().then(setData).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function renew(item: ComplianceItem, date: string) {
    await api.renewItem(item.id, date);
    load();
  }

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return <div className="boot" aria-busy="true" />;

  const { counts } = data;
  const total = counts.active + counts.expiring_soon + counts.expired;

  return (
    <>
      <header className="page-head">
        <h1>{data.org_name}</h1>
        {data.plan_tier && <p className="muted">{PLAN_LABEL[data.plan_tier] ?? data.plan_tier}</p>}
      </header>

      <div className="radar">
        <ScoreSeal score={data.score} />

        <section className="ledger" aria-labelledby="action-title">
          <div className="ledger-head">
            <h2 id="action-title">يحتاج تدخلك</h2>
            <p className="muted">ما ينتهي خلال 15 يوماً أو انتهى فعلاً</p>
          </div>
          {data.action_required.length === 0 ? (
            <div className="ledger-empty">
              <p>لا شيء عاجل. أقرب موعد خارج نافذة الخمسة عشر يوماً.</p>
              {total === 0 && <Link className="btn" href="/licenses">أضف أول ترخيص</Link>}
            </div>
          ) : (
            <ol className="rows">
              {data.action_required.map((it) => <ItemRow key={it.id} item={it} onRenew={renew} />)}
            </ol>
          )}
        </section>
      </div>

      <p className="tally">
        {total === 0 ? (
          "لم تُسجَّل أي تراخيص بعد."
        ) : (
          <>
            تتابع حصيف <strong>{total}</strong> من تراخيص منشأتك والتزاماتها:{" "}
            <span className="status" data-s="ACTIVE">{counts.active} ساري</span>،{" "}
            <span className="status" data-s="EXPIRING_SOON">{counts.expiring_soon} قارب على الانتهاء</span>،{" "}
            <span className="status" data-s="EXPIRED">{counts.expired} منتهٍ</span>
            {counts.policies_due > 0 && <>، و{counts.policies_due} {counts.policies_due === 1 ? "سياسة تحتاج" : "سياسات تحتاج"} مراجعة</>}.
          </>
        )}
      </p>
    </>
  );
}
