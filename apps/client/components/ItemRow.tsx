"use client";

import { useState } from "react";
import { CATEGORY_LABEL, RISK_LABEL, STATUS_LABEL, expiryLine, formatDate, type ComplianceItem } from "@haseef/shared";

/** سطر في سجل التراخيص: العدّاد الزمني هو المعلومة الأولى، والباقي يدعمه. */
export function ItemRow({ item, onRenew }: { item: ComplianceItem; onRenew?: (item: ComplianceItem, date: string) => Promise<void> }) {
  const [renewing, setRenewing] = useState(false);
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!onRenew || !date) return;
    setBusy(true);
    setError(null);
    try {
      await onRenew(item, date);
      setRenewing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر حفظ التجديد");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="row" data-s={item.status}>
      <div className="row-days" aria-hidden="true">
        <span className="row-days-n">{Math.abs(item.days_remaining)}</span>
        <span className="row-days-u">{item.days_remaining < 0 ? "يوم مضى" : "يوم باقٍ"}</span>
      </div>
      <div className="row-main">
        <h3>{item.title}</h3>
        <p className="muted">
          {CATEGORY_LABEL[item.category]}
          {item.reference_number ? `، رقم ${item.reference_number}` : ""}
        </p>
      </div>
      <div className="row-when">
        <span className="status" data-s={item.status}>{expiryLine(item.days_remaining)}</span>
        <span className="muted">{formatDate(item.expiry_date)}، خطورة {RISK_LABEL[item.risk_level]}</span>
        <span className="sr-only">{STATUS_LABEL[item.status]}</span>
      </div>
      <div className="row-actions">
        {item.renewal_url && (
          <a className="link" href={item.renewal_url} target="_blank" rel="noopener noreferrer">
            منصة التجديد
          </a>
        )}
        {onRenew && !renewing && (
          <button className="btn btn-quiet" type="button" onClick={() => setRenewing(true)}>سجّل التجديد</button>
        )}
      </div>
      {renewing && (
        <form className="row-renew" onSubmit={submit}>
          <div className="field">
            <label htmlFor={`exp-${item.id}`}>تاريخ الانتهاء الجديد</label>
            <input id={`exp-${item.id}`} type="date" required min={item.expiry_date} value={date}
                   onChange={(e) => setDate(e.target.value)} />
          </div>
          <button className="btn" type="submit" disabled={busy}>{busy ? "جارٍ الحفظ…" : "احفظ التجديد"}</button>
          <button className="btn btn-quiet" type="button" onClick={() => setRenewing(false)}>إلغاء</button>
          {error && <p className="error" role="alert">{error}</p>}
        </form>
      )}
    </li>
  );
}
