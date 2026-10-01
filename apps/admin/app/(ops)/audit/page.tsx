"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AUDIT_ACTION_LABEL, PLATFORM_ROLE_LABEL, type AuditEntry } from "@haseef/shared";
import { fmtDateTime } from "@/components/ui";
import { api } from "@/lib/session";

function summary(c: Record<string, unknown> | null): string {
  if (!c) return "";
  return Object.entries(c)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("، ");
}

export default function Audit() {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [onlyAdmin, setOnlyAdmin] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.admin.audit().then(setRows).catch((e: Error) => setError(e.message)); }, []);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!rows) return null;
  const shown = onlyAdmin ? rows.filter((r) => r.action.startsWith("ADMIN_")) : rows;

  return (
    <>
      <h1>سجل التدقيق</h1>
      <p className="muted">كل إجراء على المنصة: من فعله، ومتى، ومن أي عنوان. السجل للإضافة فقط ولا يمكن تعديله أو حذفه.</p>
      <div className="filters" role="group" aria-label="تصفية">
        <button type="button" aria-pressed={onlyAdmin} onClick={() => setOnlyAdmin(true)}>إجراءات فريق حصيف</button>
        <button type="button" aria-pressed={!onlyAdmin} onClick={() => setOnlyAdmin(false)}>كل الأحداث</button>
      </div>
      {shown.length === 0 ? <p className="muted">لا أحداث.</p> : (
        <table className="table">
          <thead><tr><th>الوقت</th><th>الإجراء</th><th>الفاعل</th><th>المنشأة</th><th>التفاصيل</th><th>العنوان</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td>{fmtDateTime(r.created_at)}</td>
                <td><strong>{AUDIT_ACTION_LABEL[r.action] ?? r.action}</strong></td>
                <td>{r.actor ?? "النظام"}{r.actor_role && <div className="muted small">{PLATFORM_ROLE_LABEL[r.actor_role]}</div>}</td>
                <td>{r.org_id ? <Link href={`/organizations/${r.org_id}`}>{r.org_name}</Link> : "—"}</td>
                <td className="small audit-details">{summary(r.changes)}</td>
                <td><bdi dir="ltr" className="small">{r.ip ?? "—"}</bdi></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
