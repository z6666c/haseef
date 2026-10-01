"use client";

import { useState } from "react";
import { CATEGORY_LABEL, RISK_LABEL, expiryLine, formatDate, type ComplianceItem } from "@haseef/shared";
import { WhatsApp } from "./Icons";

/** جدول الطوارئ (دليل الهوية §3.2): مرتب بالأولوية، مع إرسال تذكير واتساب فوري. */
export function DeadlinesTable({ items, onRemind, onRenew }: {
  items: ComplianceItem[];
  onRemind: (item: ComplianceItem) => Promise<string>;
  onRenew: (item: ComplianceItem, date: string) => Promise<void>;
}) {
  const [feedback, setFeedback] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [renewing, setRenewing] = useState<string | null>(null);
  const [date, setDate] = useState("");

  // الأولوية: الحرج المنتهي أولاً، ثم الأقرب انتهاءً
  const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 } as const;
  const sorted = [...items].sort((a, b) =>
    (a.days_remaining < 0 ? 0 : 1) - (b.days_remaining < 0 ? 0 : 1)
    || rank[a.risk_level] - rank[b.risk_level]
    || a.days_remaining - b.days_remaining);

  async function remind(it: ComplianceItem) {
    setBusy(it.id);
    try {
      const msg = await onRemind(it);
      setFeedback((f) => ({ ...f, [it.id]: { ok: true, text: msg } }));
    } catch (e) {
      setFeedback((f) => ({ ...f, [it.id]: { ok: false, text: e instanceof Error ? e.message : "تعذّر الإرسال" } }));
    } finally {
      setBusy(null);
    }
  }

  async function renew(e: React.FormEvent, it: ComplianceItem) {
    e.preventDefault();
    if (!date) return;
    setBusy(it.id);
    try {
      await onRenew(it, date);
      setRenewing(null);
      setDate("");
    } catch (err) {
      setFeedback((f) => ({ ...f, [it.id]: { ok: false, text: err instanceof Error ? err.message : "تعذّر حفظ التجديد" } }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <table className="deadlines">
      <thead>
        <tr>
          <th scope="col">المتبقي</th>
          <th scope="col">الالتزام</th>
          <th scope="col">الموعد</th>
          <th scope="col">الخطورة</th>
          <th scope="col"><span className="sr-only">الإجراءات</span></th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((it) => (
          <tr key={it.id} data-s={it.status}>
            <td className="dl-days">
              <b dir="ltr">{Math.abs(it.days_remaining)}</b>
              <small>{it.days_remaining < 0 ? "يوم مضى" : "يوم باقٍ"}</small>
            </td>
            <td>
              <strong>{it.title}</strong>
              <div className="muted small">{CATEGORY_LABEL[it.category]}{it.reference_number ? `، رقم ${it.reference_number}` : ""}</div>
            </td>
            <td>
              <span className="status" data-s={it.status}>{expiryLine(it.days_remaining)}</span>
              <div className="muted small" dir="ltr">{formatDate(it.expiry_date)}</div>
            </td>
            <td><span className="risk" data-r={it.risk_level}>{RISK_LABEL[it.risk_level]}</span></td>
            <td className="dl-actions">
              {renewing === it.id ? (
                <form onSubmit={(e) => renew(e, it)} className="dl-renew">
                  <label className="sr-only" htmlFor={`d-${it.id}`}>تاريخ الانتهاء الجديد</label>
                  <input id={`d-${it.id}`} type="date" required min={it.expiry_date} value={date} onChange={(e) => setDate(e.target.value)} />
                  <button className="btn" type="submit" disabled={busy === it.id}>احفظ</button>
                  <button className="btn btn-quiet" type="button" onClick={() => setRenewing(null)}>إلغاء</button>
                </form>
              ) : (
                <>
                  <button className="btn btn-quiet" type="button" disabled={busy === it.id} onClick={() => remind(it)}>
                    <WhatsApp size={18} /> {busy === it.id ? "جارٍ الإرسال…" : "أرسل تذكيراً الآن"}
                  </button>
                  <button className="btn btn-quiet" type="button" onClick={() => { setRenewing(it.id); setDate(""); }}>سجّل التجديد</button>
                </>
              )}
              {feedback[it.id] && (
                <p className={feedback[it.id].ok ? "dl-ok" : "error"} role="status">{feedback[it.id].text}</p>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
