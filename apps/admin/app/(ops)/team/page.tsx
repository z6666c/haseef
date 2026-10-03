"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdminPermission, AdminRole, TeamMember } from "@haseef/shared";
import { Dialog, TempPasswordDialog, fmtDateTime, useAdminMe, useCan } from "@/components/ui";
import { api } from "@/lib/session";

type RoleForm = { code: string | null; name: string; description: string; permissions: string[] };

export default function Team() {
  const can = useCan();
  const me = useAdminMe();
  const manager = can("team.manage");
  const [tab, setTab] = useState<"members" | "roles">("members");
  const [rows, setRows] = useState<TeamMember[] | null>(null);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [catalog, setCatalog] = useState<AdminPermission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [tempPw, setTempPw] = useState<{ pw: string; email: string } | null>(null);
  const [form, setForm] = useState({ email: "", full_name: "", role: "" });
  const [roleForm, setRoleForm] = useState<RoleForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.admin.team().then(setRows).catch((e: Error) => setError(e.message));
    api.admin.roles().then((r) => { setRoles(r.roles); setCatalog(r.permissions); }).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const roleName = (code: string) => roles.find((r) => r.code === code)?.name ?? code;
  const mine = useMemo(() => new Set(me?.role === "SUPER_ADMIN" ? catalog.map((p) => p.code) : me?.permissions ?? []), [me, catalog]);
  // من لا يملك صلاحيات دورٍ ما لا يستطيع منحه (يمنع تصعيد الصلاحيات) — الخادم يفرض ذلك أيضاً
  const grantable = (r: AdminRole) => me?.role === "SUPER_ADMIN" || (r.code !== "SUPER_ADMIN" && r.permissions.every((p) => mine.has(p)));
  const groups = useMemo(() => {
    const g = new Map<string, AdminPermission[]>();
    for (const p of catalog) g.set(p.group, [...(g.get(p.group) ?? []), p]);
    return [...g.entries()];
  }, [catalog]);
  const permName = (code: string) => catalog.find((p) => p.code === code)?.name ?? code;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setFormError(null);
    try {
      const r = await api.admin.teamAdd(form);
      setAdding(false);
      setNotice(`أُضيف ${form.full_name} إلى الفريق بدور «${roleName(form.role)}»`);
      if (r.temporary_password) setTempPw({ pw: r.temporary_password, email: form.email });
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "تعذّرت الإضافة");
    } finally { setBusy(false); }
  }

  async function changeRole(m: TeamMember, role: string | null) {
    setNotice(null);
    try {
      await api.admin.teamRole(m.id, role);
      setNotice(role ? `صار دور ${m.full_name}: ${roleName(role)}` : `أُزيل ${m.full_name} من الفريق`);
      load();
    } catch (err) { setNotice(err instanceof Error ? err.message : "تعذّر التغيير"); }
  }

  async function saveRole(e: React.FormEvent) {
    e.preventDefault();
    if (!roleForm) return;
    setBusy(true); setFormError(null);
    const b = { name: roleForm.name.trim(), description: roleForm.description.trim() || null, permissions: roleForm.permissions };
    try {
      if (roleForm.code) await api.admin.updateRole(roleForm.code, b);
      else await api.admin.createRole(b);
      setNotice(roleForm.code ? `حُدّثت صلاحيات دور «${b.name}»` : `أُنشئ دور «${b.name}»، ويمكنك الآن إسناده لعضو`);
      setRoleForm(null);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "تعذّر الحفظ");
    } finally { setBusy(false); }
  }

  async function removeRole(r: AdminRole) {
    setNotice(null);
    try { await api.admin.deleteRole(r.code); setNotice(`حُذف دور «${r.name}»`); load(); }
    catch (err) { setNotice(err instanceof Error ? err.message : "تعذّر الحذف"); }
  }

  function togglePerm(code: string) {
    if (!roleForm) return;
    const has = roleForm.permissions.includes(code);
    setRoleForm({ ...roleForm, permissions: has ? roleForm.permissions.filter((p) => p !== code) : [...roleForm.permissions, code] });
  }

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!rows) return null;
  const assignable = roles.filter(grantable);

  return (
    <>
      <div className="head-row">
        <h1>فريق حصيف</h1>
        {manager && tab === "members" && <button className="btn btn-action" type="button" disabled={!assignable.length}
          onClick={() => { setForm({ email: "", full_name: "", role: assignable.find((r) => r.code !== "SUPER_ADMIN")?.code ?? assignable[0]?.code ?? "" }); setFormError(null); setAdding(true); }}>إضافة عضو</button>}
        {manager && tab === "roles" && <button className="btn btn-action" type="button"
          onClick={() => { setRoleForm({ code: null, name: "", description: "", permissions: [] }); setFormError(null); }}>دور جديد</button>}
      </div>
      <div className="filters" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "members"} aria-pressed={tab === "members"} onClick={() => setTab("members")}>الأعضاء ({rows.length})</button>
        <button type="button" role="tab" aria-selected={tab === "roles"} aria-pressed={tab === "roles"} onClick={() => setTab("roles")}>الأدوار والصلاحيات ({roles.length})</button>
      </div>
      {!manager && <p className="hint">العرض فقط. إدارة الفريق والأدوار تتطلب صلاحية «إدارة الفريق والأدوار».</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      {tab === "members" && (
        <table className="table">
          <thead><tr><th>العضو</th><th>الدور</th><th>آخر دخول</th><th><span className="sr-only">إجراءات</span></th></tr></thead>
          <tbody>
            {rows.map((m) => {
              const mineRow = m.id === me?.user_id;
              const current = roles.find((r) => r.code === m.platform_role);
              const editable = manager && !mineRow && (!current || grantable(current));
              return (
                <tr key={m.id}>
                  <td>{m.full_name}<div className="muted small"><bdi dir="ltr">{m.email}</bdi></div></td>
                  <td>
                    {editable ? (
                      <select aria-label={`دور ${m.full_name}`} value={m.platform_role} onChange={(e) => changeRole(m, e.target.value)}>
                        {assignable.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                      </select>
                    ) : (m.role_name ?? roleName(m.platform_role))}
                    {m.must_change_password && <span className="pill">بانتظار أول دخول</span>}
                    {mineRow && <span className="pill">أنت</span>}
                  </td>
                  <td>{fmtDateTime(m.last_login_at)}</td>
                  <td className="row-actions-cell">
                    {editable && <button className="link-btn danger" type="button" onClick={() => changeRole(m, null)}>إزالة من الفريق</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {tab === "roles" && (
        <div className="roles-grid">
          {roles.map((r) => (
            <article key={r.code} className="role-card">
              <header>
                <h2>{r.name}</h2>
                <span className="pill">{r.members} {r.members === 1 ? "عضو" : "أعضاء"}</span>
                {r.is_system ? <span className="pill">أساسي</span> : <span className="pill" data-tone="good">مخصص</span>}
              </header>
              {r.description && <p className="muted small">{r.description}</p>}
              {r.code === "SUPER_ADMIN"
                ? <p className="small">كل الصلاحيات دائماً، ولا يمكن تقييده.</p>
                : <ul className="perm-list">{r.permissions.map((p) => <li key={p}>{permName(p)}</li>)}</ul>}
              {manager && r.code !== "SUPER_ADMIN" && grantable(r) && (
                <div className="row-actions">
                  <button className="link-btn" type="button"
                    onClick={() => { setRoleForm({ code: r.code, name: r.name, description: r.description ?? "", permissions: [...r.permissions] }); setFormError(null); }}>تعديل الصلاحيات</button>
                  {!r.is_system && <button className="link-btn danger" type="button" disabled={r.members > 0}
                    title={r.members > 0 ? "انقل أعضاءه لدور آخر أولاً" : undefined} onClick={() => removeRole(r)}>حذف</button>}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <Dialog open={adding} title="إضافة عضو لفريق حصيف" onClose={() => setAdding(false)}>
        <form className="dialog-body" onSubmit={add}>
          <div className="field"><label htmlFor="t-name">الاسم الكامل</label>
            <input id="t-name" required minLength={2} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
          <div className="field"><label htmlFor="t-email">البريد الإلكتروني</label>
            <input id="t-email" type="email" required dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="field"><label htmlFor="t-role">الدور</label>
            <select id="t-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {assignable.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
            </select>
            {(() => { const r = roles.find((x) => x.code === form.role); return r && (
              <p className="hint">{r.code === "SUPER_ADMIN" ? "كل الصلاحيات" : r.permissions.map(permName).join("، ")}</p>); })()}
            {manager && <button className="link-btn" type="button" onClick={() => { setAdding(false); setTab("roles");
              setRoleForm({ code: null, name: "", description: "", permissions: [] }); setFormError(null); }}>تحتاج مسمى آخر؟ أنشئ دوراً جديداً بالصلاحيات التي تريدها</button>}
          </div>
          {formError && <p className="error" role="alert">{formError}</p>}
          <div className="dialog-actions">
            <button className="btn btn-action" type="submit" disabled={busy || !form.role}>أضف العضو</button>
            <button className="btn btn-quiet" type="button" onClick={() => setAdding(false)}>إلغاء</button>
          </div>
        </form>
      </Dialog>

      <Dialog open={!!roleForm} title={roleForm?.code ? `تعديل دور «${roleForm.name}»` : "دور جديد"} onClose={() => setRoleForm(null)}>
        {roleForm && (
          <form className="dialog-body" onSubmit={saveRole}>
            <div className="field"><label htmlFor="r-name">مسمى الدور</label>
              <input id="r-name" required minLength={2} maxLength={80} placeholder="مثال: مدير الحسابات، محرر المحتوى، مشرف المبيعات"
                     value={roleForm.name} onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="r-desc">وصف مختصر (اختياري)</label>
              <input id="r-desc" maxLength={500} value={roleForm.description} onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })} /></div>
            <fieldset className="perm-picker">
              <legend>الصلاحيات ({roleForm.permissions.length} من {catalog.length})</legend>
              {groups.map(([g, perms]) => (
                <div key={g} className="perm-group">
                  <h3>{g}</h3>
                  {perms.map((p) => (
                    <label key={p.code} className="perm-option" data-off={!mine.has(p.code) || undefined}>
                      <input type="checkbox" checked={roleForm.permissions.includes(p.code)} disabled={!mine.has(p.code)} onChange={() => togglePerm(p.code)} />
                      <span><b>{p.name}</b><small>{p.description}</small></span>
                    </label>
                  ))}
                </div>
              ))}
            </fieldset>
            {formError && <p className="error" role="alert">{formError}</p>}
            <div className="dialog-actions">
              <button className="btn btn-action" type="submit" disabled={busy || !roleForm.permissions.length}>{roleForm.code ? "حفظ التعديل" : "أنشئ الدور"}</button>
              <button className="btn btn-quiet" type="button" onClick={() => setRoleForm(null)}>إلغاء</button>
            </div>
          </form>
        )}
      </Dialog>
      <TempPasswordDialog password={tempPw?.pw ?? null} email={tempPw?.email} onClose={() => setTempPw(null)} />
    </>
  );
}
