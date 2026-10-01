"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { PlatformRole } from "@haseef/shared";

/* ---------- دور المستخدم الحالي في فريق حصيف ---------- */
export const RoleContext = createContext<PlatformRole | null>(null);

/** هل يملك الدور الحالي هذا الإجراء؟ المدير العام يملك كل شيء. الخادم يفرض ذلك على أي حال. */
export function useCan() {
  const role = useContext(RoleContext);
  return (...roles: PlatformRole[]) => role === "SUPER_ADMIN" || (role !== null && roles.includes(role));
}

/* ---------- نافذة حوار ---------- */
export function Dialog({ open, title, onClose, children }: {
  open: boolean; title: string; onClose: () => void; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="dlg-title">
      <div className="dialog-head">
        <h2 id="dlg-title">{title}</h2>
        <button type="button" className="dialog-x" onClick={onClose} aria-label="إغلاق">×</button>
      </div>
      {open && children}
    </dialog>
  );
}

/**
 * إجراء يحتاج سبباً مكتوباً، واختيارياً كتابة اسم المنشأة للتأكيد (للإجراءات الخطرة).
 */
export function ReasonDialog({ open, title, description, confirmLabel, danger, confirmText, onClose, onConfirm }: {
  open: boolean; title: string; description: string; confirmLabel: string; danger?: boolean;
  confirmText?: string; onClose: () => void; onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setReason(""); setTyped(""); setError(null); } }, [open]);

  const ready = reason.trim().length >= 5 && (!confirmText || typed.trim() === confirmText);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر تنفيذ الإجراء");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title={title} onClose={onClose}>
      <form onSubmit={submit} className="dialog-body">
        <p>{description}</p>
        <div className="field">
          <label htmlFor="reason">السبب (يُحفظ في سجل التدقيق)</label>
          <textarea id="reason" rows={3} required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {confirmText && (
          <div className="field">
            <label htmlFor="typed">للتأكيد اكتب اسم المنشأة: <strong>{confirmText}</strong></label>
            <input id="typed" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button className={danger ? "btn btn-danger" : "btn"} type="submit" disabled={!ready || busy}>
            {busy ? "جارٍ التنفيذ…" : confirmLabel}
          </button>
          <button className="btn btn-quiet" type="button" onClick={onClose}>إلغاء</button>
        </div>
      </form>
    </Dialog>
  );
}

/** تُعرض كلمة المرور المؤقتة مرة واحدة فقط. */
export function TempPasswordDialog({ password, email, onClose }: { password: string | null; email?: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [password]);
  return (
    <Dialog open={password !== null} title="كلمة مرور مؤقتة" onClose={onClose}>
      <div className="dialog-body">
        <p>
          سلّمها لصاحب الحساب{email ? <> (<bdi dir="ltr">{email}</bdi>)</> : null} بطريقة آمنة.
          <strong> لن تظهر مرة أخرى</strong>، وسيُطلب منه تغييرها عند أول دخول.
        </p>
        <div className="temp-pw">
          <code dir="ltr">{password}</code>
          <button type="button" className="btn btn-quiet" onClick={async () => {
            if (!password) return;
            try { await navigator.clipboard.writeText(password); setCopied(true); } catch { /* الحافظة غير متاحة */ }
          }}>{copied ? "نُسخت" : "انسخ"}</button>
        </div>
        <div className="dialog-actions">
          <button className="btn" type="button" onClick={onClose}>تم، سلّمتها</button>
        </div>
      </div>
    </Dialog>
  );
}

export function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh",
  }).format(new Date(iso));
}
