"use client";

import { useEffect, useState } from "react";
import { formatDate, type AdminDispatches } from "@haseef/shared";
import { api } from "@/lib/session";

const STATUS: Record<string, string> = {
  QUEUED: "في الطابور", SENDING: "يُرسل الآن", SENT: "أُرسلت", DELIVERED: "سُلّمت", READ: "قُرئت",
  FAILED: "فشلت", SKIPPED: "تُخطيت", CANCELED: "أُلغيت",
};
const TONE: Record<string, string> = { FAILED: "bad", SKIPPED: "warn", DELIVERED: "good", READ: "good", SENT: "good" };
const SKIP: Record<string, string> = { WHATSAPP_QUOTA_EXCEEDED: "تجاوز حصة الواتساب الشهرية" };
const time = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Riyadh" }).format(new Date(iso)) : "—";

export default function Dispatches() {
  const [filter, setFilter] = useState<string>("");
  const [d, setD] = useState<AdminDispatches | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setD(null);
    api.admin.dispatches(filter || undefined).then(setD).catch((e: Error) => setError(e.message));
  }, [filter]);

  if (error) return <p className="error" role="alert">{error}</p>;

  const week = d?.last_7_days ?? [];
  const sum = (st: string[]) => week.filter((w) => st.includes(w.status)).reduce((s, w) => s + w.n, 0);

  return (
    <>
      <h1>مراقب التنبيهات</h1>
      <p className="muted">آخر 7 أيام: {sum(["SENT", "DELIVERED", "READ"])} وصلت، {sum(["QUEUED", "SENDING"])} في الطابور، {sum(["FAILED"])} فشلت، {sum(["SKIPPED"])} تُخطيت.</p>

      <div className="filters" role="group" aria-label="تصفية حسب الحالة">
        {["", "FAILED", "QUEUED", "SKIPPED", "SENT", "DELIVERED"].map((s) => (
          <button key={s} type="button" aria-pressed={filter === s} onClick={() => setFilter(s)}>{s ? STATUS[s] : "الكل"}</button>
        ))}
      </div>

      {!d ? null : d.items.length === 0 ? (
        <p className="muted">لا توجد رسائل بهذه الحالة.</p>
      ) : (
        <table className="table">
          <thead>
            <tr><th>المنشأة</th><th>القناة</th><th>المستلم</th><th>العتبة</th><th>الاستحقاق</th><th>الحالة</th><th>الموعد</th><th>أُرسلت</th><th className="num">المحاولات</th></tr>
          </thead>
          <tbody>
            {d.items.map((r) => (
              <tr key={r.id}>
                <td>{r.org_name}<div className="muted small">{r.target_type === "POLICY" ? "سياسة" : "ترخيص"}</div></td>
                <td>{r.channel === "WHATSAPP" ? "واتساب" : "بريد"}</td>
                <td dir="ltr" className="mono-num">{r.recipient_address}</td>
                <td className="num">{r.threshold_days === 0 ? "يوم الانتهاء" : `${r.threshold_days} يوم`}</td>
                <td>{formatDate(r.due_date)}</td>
                <td>
                  <span className="pill" data-tone={TONE[r.status] ?? "none"}>{STATUS[r.status] ?? r.status}</span>
                  {r.last_error && <div className="error small" title={r.last_error}>{r.last_error.slice(0, 60)}</div>}
                  {r.skip_reason && <div className="muted small">{SKIP[r.skip_reason] ?? r.skip_reason}</div>}
                </td>
                <td>{time(r.scheduled_for)}</td>
                <td>{time(r.sent_at)}{r.provider && <div className="muted small">{r.provider}</div>}</td>
                <td className="num">{r.attempts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
