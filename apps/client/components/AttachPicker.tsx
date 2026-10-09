"use client";

import { useRef, useState } from "react";
import { ATTACH_ACCEPT, fmtSize, prepareAttachment, type LeaveAttachment } from "@haseef/shared";

/** اختيار التقرير الطبي: تصوير مباشر بالجوال أو اختيار صورة/PDF. تُصغَّر الصورة في الجوال قبل الرفع. */
export function AttachPicker({ value, onChange, required, label = "التقرير الطبي" }: {
  value: LeaveAttachment | null; onChange: (a: LeaveAttachment | null) => void; required?: boolean; label?: string;
}) {
  const cam = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function onFile(f: File | undefined) {
    if (!f) return;
    setBusy(true); setErr(null);
    try { onChange(await prepareAttachment(f)); } catch (e) { setErr(e instanceof Error ? e.message : "تعذّر تجهيز الملف"); onChange(null); }
    finally { setBusy(false); if (cam.current) cam.current.value = ""; if (pick.current) pick.current.value = ""; }
  }
  const size = value ? Math.floor((value.file_base64.length * 3) / 4) : 0;
  return (
    <div className="field attach-picker">
      <span className="label-like">{label}{required ? " (مطلوب)" : " (اختياري)"}</span>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      <input ref={pick} type="file" accept={ATTACH_ACCEPT} hidden onChange={(e) => onFile(e.target.files?.[0])} />
      {value ? (
        <div className="attach-chip">
          <span aria-hidden>📎</span><span className="attach-name">{value.file_name}</span><span className="small muted">{fmtSize(size)}</span>
          <button type="button" className="link-btn" onClick={() => onChange(null)}>إزالة</button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-xs" disabled={busy} onClick={() => cam.current?.click()}>📷 صوّر التقرير</button>
          <button type="button" className="btn btn-quiet btn-xs" disabled={busy} onClick={() => pick.current?.click()}>اختر صورة أو PDF</button>
          {busy && <span className="small muted" aria-busy="true">جارٍ التجهيز…</span>}
        </div>
      )}
      {err && <span className="error small" role="alert">{err}</span>}
    </div>
  );
}
