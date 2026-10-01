"use client";

import { useCallback, useEffect, useState } from "react";
import { PLATFORM_ROLE_LABEL, type PlatformRole, type TeamMember } from "@haseef/shared";
import { Dialog, TempPasswordDialog, fmtDateTime, useCan } from "@/components/ui";
import { api } from "@/lib/session";

const ROLE_HELP: Record<PlatformRole, string> = {
  SUPER_ADMIN: "كل الصلاحيات، بما فيها تعليق المنشآت وإدارة الفريق",
  SUPPORT: "إنشاء المنشآت وتعديلها وإدارة مستخدميها",
  BILLING: "الاشتراكات والدفعات والباقات",
};

export default function Team() {
  const can = useCan();
  const [rows, setRows] = useState<TeamMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [tempPw, setTempPw] = useState<{ pw: string; email: string } | null>(null);
  const [form, setForm] = useState({ email: "", full_name: "", role: "SUPPORT" as PlatformRole });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [meId, setMeId] = useState<string | null>(null);
  const load = useCallback(() => { api.admin.team().then(setRows).catch((e: Error) => setError(e.message)); }, []);
  useEffect(load, [load]);
  useEffect(() => { api.admin.me().then((m) => setMeId(m.user_id)).catch(() => {}); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setFormError(null);
    try {
      const r = await api.admin.teamAdd(form);
      setAdding(false);
      setNotice(`أُضيف ${form.full_name} إلى الفريق`);
      if (r.temporary_password) setTempPw({ pw: r.temporary_password, email: form.email });
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "تعذّرت الإضافة");
    } finally { setBusy(false); }
  }

  async function changeRole(m: TeamMember, role: PlatformRole | null) {
    setNotice(null);
    try {
      await api.admin.teamRole(m.id, role);
      setNotice(role ? `صار دور ${m.full_name}: ${PLATFORM_ROLE_LABEL[role]}` : `أُزيل ${m.full_name} من الفريق`);
      load();
    } catch (err) { setNotice(err instanceof Error ? err.message : "تعذّر التغيير"); }
  }

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!rows) return null;
  const isSuper = can();

  return (
    <>
      <div className="head-row">
        <h1>فريق حصيف</h1>
        {isSuper && <button className="btn btn-action" type="button" onClick={() => { setForm({ email: "", full_name: "", role: "SUPPORT" }); setFormError(null); setAdding(true); }}>إضافة عضو</button>}
      </div>
      {!isSuper && <p className="hint">إدارة الفريق متاحة للمدير العام فقط.</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      <dl className="role-legend">
        {(Object.keys(ROLE_HELP) as PlatformRole[]).map((r) => <div key={r}><dt>{PLATFORM_ROLE_LABEL[r]}</dt><dd>{ROLE_HELP[r]}</dd></div>)}
      </dl>

      <table className="table">
        <thead><tr><th>العضو</th><th>الدور</th><th>آخر دخول</th><th><span className="sr-only">إجراءات</span></th></tr></thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id}>
              <td>{m.full_name}<div className="muted small"><bdi dir="ltr">{m.email}</bdi></div></td>
              <td>
                {isSuper && m.id !== meId ? (
                  <select aria-label={`دور ${m.full_name}`} value={m.platform_role}
                          onChange={(e) => changeRole(m, e.target.value as PlatformRole)}>
                    {(Object.keys(ROLE_HELP) as PlatformRole[]).map((r) => <option key={r} value={r}>{PLATFORM_ROLE_LABEL[r]}</option>)}
                  </select>
                ) : PLATFORM_ROLE_LABEL[m.platform_role]}
                {m.must_change_password && <span className="pill">بانتظار أول دخول</span>}
                {m.id === meId && <span className="pill">أنت</span>}
              </td>
              <td>{fmtDateTime(m.last_login_at)}</td>
              <td className="row-actions-cell">
                {isSuper && m.id !== meId && <button className="link-btn danger" type="button" onClick={() => changeRole(m, null)}>إزالة من الفريق</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Dialog open={adding} title="إضافة عضو لفريق حصيف" onClose={() => setAdding(false)}>
        <form className="dialog-body" onSubmit={add}>
          <div className="field"><label htmlFor="t-name">الاسم الكامل</label>
            <input id="t-name" required minLength={2} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
          <div className="field"><label htmlFor="t-email">البريد الإلكتروني</label>
            <input id="t-email" type="email" required dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="field"><label htmlFor="t-role">الدور</label>
            <select id="t-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as PlatformRole })}>
              {(Object.keys(ROLE_HELP) as PlatformRole[]).map((r) => <option key={r} value={r}>{PLATFORM_ROLE_LABEL[r]}</option>)}
            </select>
            <p className="hint">{ROLE_HELP[form.role]}</p></div>
          {formError && <p className="error" role="alert">{formError}</p>}
          <div className="dialog-actions">
            <button className="btn btn-action" type="submit" disabled={busy}>أضف العضو</button>
            <button className="btn btn-quiet" type="button" onClick={() => setAdding(false)}>إلغاء</button>
          </div>
        </form>
      </Dialog>
      <TempPasswordDialog password={tempPw?.pw ?? null} email={tempPw?.email} onClose={() => setTempPw(null)} />
    </>
  );
}
