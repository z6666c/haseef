"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  auditSummary,
  AUDIT_ACTION_LABEL, BILLING_EVENT_LABEL, BILLING_STATUS_LABEL, LEGAL_TYPE_LABEL, ORG_ROLE_LABEL, PLAN_LABEL,
  SIZE_LABEL, countDays, formatDate, type AdminMember, type AdminOrgDetail, type AuditEntry,
} from "@haseef/shared";
import { Dialog, ReasonDialog, TempPasswordDialog, fmtDateTime, useCan } from "@/components/ui";
import { api } from "@/lib/session";

type Pending =
  | { kind: "suspend" } | { kind: "reactivate" } | { kind: "cancel" }
  | { kind: "disable"; member: AdminMember } | null;

export default function OrgDetail() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const [d, setD] = useState<AdminOrgDetail | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [tempPw, setTempPw] = useState<{ pw: string; email: string } | null>(null);
  const [dialog, setDialog] = useState<"payment" | "plan" | "trial" | "invite" | null>(null);

  const load = useCallback(() => {
    api.admin.orgDetail(id).then(setD).catch((e: Error) => setError(e.message));
    api.admin.audit(id).then(setAudit).catch(() => {});
  }, [id]);
  useEffect(load, [load]);

  /** ينفذ إجراءً، ويعرض نتيجته، ويعيد التحميل. يرمي الخطأ لمن يحتاج عرضه داخل نافذة. */
  async function act<T>(fn: () => Promise<T>, done: string): Promise<T> {
    setNotice(null);
    const r = await fn();
    setNotice(done);
    load();
    return r;
  }

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!d) return null;
  const o = d.organization, s = d.subscription;
  const suspended = !!o.suspended_at;

  return (
    <>
      <p className="crumbs"><Link href="/organizations">المنشآت</Link> / {o.name}</p>

      <header className="org-head">
        <div>
          <h1>{o.name} {suspended && <span className="pill" data-tone="bad">معلّقة</span>}</h1>
          <p className="muted">
            {LEGAL_TYPE_LABEL[o.entity_legal_type] ?? o.entity_legal_type}
            {o.commercial_size && `، ${SIZE_LABEL[o.commercial_size]}`}
            {o.industry_type && `، ${o.industry_type}`}
            ، السجل التجاري <bdi dir="ltr">{o.cr_number}</bdi>
          </p>
          {suspended && <p className="suspend-note">سبب التعليق: {o.suspension_reason} ({fmtDateTime(o.suspended_at)})</p>}
        </div>
        {can() && (suspended
          ? <button className="btn" type="button" onClick={() => setPending({ kind: "reactivate" })}>إعادة التفعيل</button>
          : <button className="btn btn-danger-quiet" type="button" onClick={() => setPending({ kind: "suspend" })}>تعليق المنشأة</button>)}
      </header>

      {notice && <p className="notice" role="status">{notice}</p>}

      <dl className="kpis compact">
        <div><dt>مؤشر حصيف</dt><dd>{o.haseef_score ?? "—"}{o.haseef_score !== null && <small>%</small>}</dd></div>
        <div><dt>التراخيص المتابَعة</dt><dd>{d.counts.items}</dd></div>
        <div><dt>منتهية</dt><dd>{d.counts.expired}</dd></div>
        <div><dt>السياسات</dt><dd>{d.counts.policies}</dd></div>
      </dl>

      {/* ---------------- الاشتراك ---------------- */}
      <section className="block">
        <div className="block-head">
          <h2>الاشتراك</h2>
          <div className="block-actions">
            {can("BILLING") && <button className="btn btn-action" type="button" onClick={() => setDialog("payment")}>تسجيل دفعة</button>}
            {can("BILLING") && s && <button className="btn btn-quiet" type="button" onClick={() => setDialog("plan")}>تغيير الباقة</button>}
            {can("BILLING", "SUPPORT") && s?.billing_status === "TRIAL" && <button className="btn btn-quiet" type="button" onClick={() => setDialog("trial")}>تمديد التجربة</button>}
            {can("BILLING") && s && <button className="btn btn-danger-quiet" type="button" onClick={() => setPending({ kind: "cancel" })}>إلغاء الاشتراك</button>}
          </div>
        </div>
        {s ? (
          <dl className="facts">
            <div><dt>الباقة</dt><dd>{PLAN_LABEL[s.plan_tier]}</dd></div>
            <div><dt>الحالة</dt><dd><span className="pill" data-tone={s.billing_status === "ACTIVE" ? "good" : s.billing_status === "TRIAL" ? "none" : "warn"}>{BILLING_STATUS_LABEL[s.billing_status]}</span></dd></div>
            <div><dt>الدورة</dt><dd>{s.billing_cycle === "YEARLY" ? "سنوية" : "شهرية"}</dd></div>
            <div><dt>ينتهي</dt><dd>{formatDate(s.ends_at)}</dd></div>
          </dl>
        ) : (
          <p className="muted">لا يوجد اشتراك قائم، والتنبيهات متوقفة. سجّل دفعة لبدء اشتراك.</p>
        )}
        {d.billing.length > 0 && (
          <table className="table compact-table">
            <thead><tr><th>الحدث</th><th>الباقة</th><th className="num">المبلغ</th><th>المرجع</th><th>ملاحظة</th><th>بواسطة</th><th>التاريخ</th></tr></thead>
            <tbody>
              {d.billing.map((b, i) => (
                <tr key={i}>
                  <td>{BILLING_EVENT_LABEL[b.event_type] ?? b.event_type}</td>
                  <td>{b.plan_tier ? PLAN_LABEL[b.plan_tier] : "—"}</td>
                  <td className="num">{b.amount_sar ? `${Number(b.amount_sar).toLocaleString("en")} ريال` : "—"}</td>
                  <td>{b.reference ?? "—"}</td>
                  <td>{b.note ?? "—"}</td>
                  <td>{b.actor ?? "—"}</td>
                  <td>{fmtDateTime(b.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ---------------- المستخدمون ---------------- */}
      <section className="block">
        <div className="block-head">
          <h2>المستخدمون <span className="muted">({d.members.length})</span></h2>
          {can("SUPPORT") && <button className="btn btn-action" type="button" onClick={() => setDialog("invite")}>دعوة مستخدم</button>}
        </div>
        <table className="table">
          <thead><tr><th>الاسم</th><th>الدور في المنشأة</th><th>آخر دخول</th><th>الحالة</th><th><span className="sr-only">إجراءات</span></th></tr></thead>
          <tbody>
            {d.members.map((m) => (
              <tr key={m.membership_id}>
                <td>{m.full_name}<div className="muted small"><bdi dir="ltr">{m.email}</bdi>{m.phone_number && <> · <bdi dir="ltr">{m.phone_number}</bdi></>}</div></td>
                <td>
                  {can("SUPPORT") ? (
                    <select aria-label={`دور ${m.full_name}`} value={m.role} onChange={(e) =>
                      act(() => api.admin.updateMembership(m.membership_id, { role: e.target.value }), `تغيّر دور ${m.full_name}`)
                        .catch((err: Error) => setNotice(err.message))}>
                      {Object.entries(ORG_ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  ) : ORG_ROLE_LABEL[m.role]}
                </td>
                <td>{fmtDateTime(m.last_login_at)}</td>
                <td>
                  {!m.user_active ? <span className="pill" data-tone="bad">معطّل</span>
                    : !m.membership_active ? <span className="pill" data-tone="warn">موقوف في المنشأة</span>
                    : m.must_change_password ? <span className="pill">بانتظار أول دخول</span>
                    : <span className="pill" data-tone="good">فعّال</span>}
                </td>
                <td className="row-actions-cell">
                  {can("SUPPORT") && !m.is_team_member && (
                    <>
                      <button className="link-btn" type="button" onClick={() =>
                        act(() => api.admin.resetPassword(m.user_id), `أُعيد تعيين كلمة مرور ${m.full_name}`)
                          .then((r) => setTempPw({ pw: r.temporary_password, email: m.email }))
                          .catch((err: Error) => setNotice(err.message))}>إعادة تعيين كلمة المرور</button>
                      {m.user_active
                        ? <button className="link-btn danger" type="button" onClick={() => setPending({ kind: "disable", member: m })}>تعطيل الحساب</button>
                        : <button className="link-btn" type="button" onClick={() =>
                            act(() => api.admin.enableUser(m.user_id), `فُعّل حساب ${m.full_name}`).catch((err: Error) => setNotice(err.message))}>تفعيل الحساب</button>}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ---------------- سجل التدقيق ---------------- */}
      <section className="block">
        <h2>سجل التدقيق لهذه المنشأة</h2>
        {audit.length === 0 ? <p className="muted">لا أحداث بعد.</p> : (
          <ol className="audit-list">
            {audit.slice(0, 30).map((a) => (
              <li key={a.id}>
                <span className="audit-when">{fmtDateTime(a.created_at)}</span>
                <span><strong>{AUDIT_ACTION_LABEL[a.action] ?? a.action}</strong> — {a.actor ?? "النظام"}</span>
                {a.changes && <span className="muted">{auditSummary(a.action, a.changes)}</span>}
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ---------------- النوافذ ---------------- */}
      <ReasonDialog open={pending?.kind === "suspend"} danger title="تعليق المنشأة"
        description="يُمنع كل مستخدمي المنشأة من الدخول، وتُلغى التنبيهات التي لم تُرسل. البيانات تبقى محفوظة ويمكن إعادة التفعيل لاحقاً."
        confirmLabel="علّق المنشأة" confirmText={o.name} onClose={() => setPending(null)}
        onConfirm={(r) => act(() => api.admin.suspend(id, r), "عُلّقت المنشأة").then(() => {})} />
      <ReasonDialog open={pending?.kind === "reactivate"} title="إعادة تفعيل المنشأة"
        description="يعود مستخدمو المنشأة للدخول فوراً." confirmLabel="أعد التفعيل" onClose={() => setPending(null)}
        onConfirm={(r) => act(() => api.admin.reactivate(id, r), "أُعيد تفعيل المنشأة").then(() => {})} />
      <ReasonDialog open={pending?.kind === "cancel"} danger title="إلغاء الاشتراك"
        description="تتوقف التنبيهات التلقائية فوراً. يمكن بدء اشتراك جديد بتسجيل دفعة."
        confirmLabel="ألغِ الاشتراك" confirmText={o.name} onClose={() => setPending(null)}
        onConfirm={(r) => act(() => api.admin.cancelSubscription(id, r), "أُلغي الاشتراك").then(() => {})} />
      <ReasonDialog open={pending?.kind === "disable"} danger title="تعطيل الحساب"
        description={pending?.kind === "disable" ? `لن يتمكن ${pending.member.full_name} من الدخول إلى أي منشأة.` : ""}
        confirmLabel="عطّل الحساب" onClose={() => setPending(null)}
        onConfirm={(r) => pending?.kind === "disable"
          ? act(() => api.admin.disableUser(pending.member.user_id, r), "عُطّل الحساب").then(() => {})
          : Promise.resolve()} />

      <PaymentDialog open={dialog === "payment"} org={d} onClose={() => setDialog(null)}
        onSubmit={(b) => act(() => api.admin.recordPayment(id, b), "سُجّلت الدفعة وفُعّل الاشتراك").then(() => {})} />
      <PlanDialog open={dialog === "plan"} current={s?.plan_tier} onClose={() => setDialog(null)}
        onSubmit={(t, n) => act(() => api.admin.changePlan(id, t, n), "تغيّرت الباقة وأُعيد حساب المؤشر").then(() => {})} />
      <TrialDialog open={dialog === "trial"} onClose={() => setDialog(null)}
        onSubmit={(days) => act(() => api.admin.extendTrial(id, days), `مُدّدت التجربة ${countDays(days)}`).then(() => {})} />
      <InviteDialog open={dialog === "invite"} onClose={() => setDialog(null)}
        onSubmit={(b) => act(() => api.admin.inviteMember(id, b), `أُضيف ${b.full_name}`).then((r) => {
          if (r.temporary_password) setTempPw({ pw: r.temporary_password, email: b.email });
        })} />
      <TempPasswordDialog password={tempPw?.pw ?? null} email={tempPw?.email} onClose={() => setTempPw(null)} />
    </>
  );
}

/* ================= نوافذ الإجراءات ================= */

function useForm<T>(open: boolean, initial: T) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setV(initial); setError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  async function run(fn: () => Promise<void>, close: () => void) {
    setBusy(true); setError(null);
    try { await fn(); close(); } catch (e) { setError(e instanceof Error ? e.message : "تعذّر التنفيذ"); } finally { setBusy(false); }
  }
  return { v, setV, busy, error, run };
}

function PaymentDialog({ open, org, onClose, onSubmit }: {
  open: boolean; org: AdminOrgDetail; onClose: () => void;
  onSubmit: (b: { amount_sar: number; billing_cycle: "MONTHLY" | "YEARLY"; plan_tier?: string; reference?: string; note?: string }) => Promise<void>;
}) {
  const s = org.subscription;
  const f = useForm(open, { cycle: "MONTHLY" as "MONTHLY" | "YEARLY", tier: s?.plan_tier ?? "PROFESSIONAL_GRC", amount: "", reference: "", note: "" });
  const prices: Record<string, [number, number]> = { ESSENTIAL: [199, 1990], PROFESSIONAL_GRC: [499, 4990], ENTERPRISE: [1299, 12990] };
  const expected = prices[f.v.tier]?.[f.v.cycle === "YEARLY" ? 1 : 0];
  return (
    <Dialog open={open} title="تسجيل دفعة" onClose={onClose}>
      <form className="dialog-body" onSubmit={(e) => { e.preventDefault(); f.run(() => onSubmit({
        amount_sar: Number(f.v.amount), billing_cycle: f.v.cycle, plan_tier: f.v.tier,
        reference: f.v.reference || undefined, note: f.v.note || undefined }), onClose); }}>
        <div className="grid">
          <div className="field"><label htmlFor="p-tier">الباقة</label>
            <select id="p-tier" value={f.v.tier} onChange={(e) => f.setV({ ...f.v, tier: e.target.value })}>
              {Object.entries(PLAN_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div className="field"><label htmlFor="p-cycle">الدورة</label>
            <select id="p-cycle" value={f.v.cycle} onChange={(e) => f.setV({ ...f.v, cycle: e.target.value as "MONTHLY" | "YEARLY" })}>
              <option value="MONTHLY">شهرية (شهر واحد)</option><option value="YEARLY">سنوية (12 شهراً)</option>
            </select></div>
          <div className="field"><label htmlFor="p-amt">المبلغ المستلم (ريال)</label>
            <input id="p-amt" type="number" min={1} step="0.01" required dir="ltr" value={f.v.amount}
                   placeholder={expected ? String(expected) : ""} onChange={(e) => f.setV({ ...f.v, amount: e.target.value })} /></div>
          <div className="field"><label htmlFor="p-ref">رقم الفاتورة أو التحويل</label>
            <input id="p-ref" dir="ltr" value={f.v.reference} onChange={(e) => f.setV({ ...f.v, reference: e.target.value })} /></div>
        </div>
        {expected && f.v.amount && Number(f.v.amount) !== expected && (
          <p className="hint warn">سعر الباقة {expected.toLocaleString("en")} ريال. المبلغ المُدخل مختلف؛ وضّح السبب في الملاحظة (خصم مثلاً).</p>
        )}
        <div className="field"><label htmlFor="p-note">ملاحظة (اختيارية)</label>
          <input id="p-note" value={f.v.note} onChange={(e) => f.setV({ ...f.v, note: e.target.value })} /></div>
        <p className="hint">{s?.billing_status === "TRIAL" ? "تنتهي الفترة التجريبية ويبدأ الاشتراك المدفوع من اليوم."
          : s ? "يُمدَّد الاشتراك من تاريخ انتهائه الحالي." : "يبدأ اشتراك جديد من اليوم."}</p>
        {f.error && <p className="error" role="alert">{f.error}</p>}
        <div className="dialog-actions">
          <button className="btn btn-action" type="submit" disabled={f.busy || !f.v.amount}>{f.busy ? "جارٍ التسجيل…" : "سجّل الدفعة"}</button>
          <button className="btn btn-quiet" type="button" onClick={onClose}>إلغاء</button>
        </div>
      </form>
    </Dialog>
  );
}

function PlanDialog({ open, current, onClose, onSubmit }: {
  open: boolean; current?: string; onClose: () => void; onSubmit: (tier: string, note?: string) => Promise<void>;
}) {
  const f = useForm(open, { tier: current ?? "ESSENTIAL", note: "" });
  return (
    <Dialog open={open} title="تغيير الباقة" onClose={onClose}>
      <form className="dialog-body" onSubmit={(e) => { e.preventDefault(); f.run(() => onSubmit(f.v.tier, f.v.note || undefined), onClose); }}>
        <div className="field"><label htmlFor="c-tier">الباقة الجديدة</label>
          <select id="c-tier" value={f.v.tier} onChange={(e) => f.setV({ ...f.v, tier: e.target.value })}>
            {Object.entries(PLAN_LABEL).map(([k, v]) => <option key={k} value={k} disabled={k === current}>{v}{k === current ? " (الحالية)" : ""}</option>)}
          </select></div>
        <div className="field"><label htmlFor="c-note">ملاحظة (اختيارية)</label>
          <input id="c-note" value={f.v.note} onChange={(e) => f.setV({ ...f.v, note: e.target.value })} /></div>
        <p className="hint">تتغير الميزات المتاحة وأركان مؤشر حصيف فوراً. الفرق المالي يُسجَّل كدفعة منفصلة.</p>
        {f.error && <p className="error" role="alert">{f.error}</p>}
        <div className="dialog-actions">
          <button className="btn" type="submit" disabled={f.busy || f.v.tier === current}>غيّر الباقة</button>
          <button className="btn btn-quiet" type="button" onClick={onClose}>إلغاء</button>
        </div>
      </form>
    </Dialog>
  );
}

function TrialDialog({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (days: number) => Promise<void> }) {
  const f = useForm(open, { days: 7 });
  return (
    <Dialog open={open} title="تمديد الفترة التجريبية" onClose={onClose}>
      <form className="dialog-body" onSubmit={(e) => { e.preventDefault(); f.run(() => onSubmit(f.v.days), onClose); }}>
        <div className="field"><label htmlFor="t-days">عدد الأيام (1 إلى 60)</label>
          <input id="t-days" type="number" min={1} max={60} required value={f.v.days} onChange={(e) => f.setV({ days: Number(e.target.value) })} /></div>
        {f.error && <p className="error" role="alert">{f.error}</p>}
        <div className="dialog-actions">
          <button className="btn" type="submit" disabled={f.busy}>مدّد التجربة</button>
          <button className="btn btn-quiet" type="button" onClick={onClose}>إلغاء</button>
        </div>
      </form>
    </Dialog>
  );
}

function InviteDialog({ open, onClose, onSubmit }: {
  open: boolean; onClose: () => void;
  onSubmit: (b: { email: string; full_name: string; phone_number?: string; role: string }) => Promise<void>;
}) {
  const f = useForm(open, { email: "", full_name: "", phone: "", role: "COMPLIANCE_OFFICER" });
  return (
    <Dialog open={open} title="دعوة مستخدم للمنشأة" onClose={onClose}>
      <form className="dialog-body" onSubmit={(e) => { e.preventDefault(); f.run(() => onSubmit({
        email: f.v.email, full_name: f.v.full_name, phone_number: f.v.phone || undefined, role: f.v.role }), onClose); }}>
        <div className="grid">
          <div className="field"><label htmlFor="i-name">الاسم الكامل</label>
            <input id="i-name" required minLength={2} value={f.v.full_name} onChange={(e) => f.setV({ ...f.v, full_name: e.target.value })} /></div>
          <div className="field"><label htmlFor="i-email">البريد الإلكتروني</label>
            <input id="i-email" type="email" required dir="ltr" value={f.v.email} onChange={(e) => f.setV({ ...f.v, email: e.target.value })} /></div>
          <div className="field"><label htmlFor="i-phone">جوال الواتساب (اختياري)</label>
            <input id="i-phone" dir="ltr" pattern="\+9665\d{8}" placeholder="+9665XXXXXXXX" value={f.v.phone} onChange={(e) => f.setV({ ...f.v, phone: e.target.value })} /></div>
          <div className="field"><label htmlFor="i-role">الدور</label>
            <select id="i-role" value={f.v.role} onChange={(e) => f.setV({ ...f.v, role: e.target.value })}>
              {Object.entries(ORG_ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
        </div>
        {f.error && <p className="error" role="alert">{f.error}</p>}
        <div className="dialog-actions">
          <button className="btn btn-action" type="submit" disabled={f.busy}>{f.busy ? "جارٍ الإضافة…" : "أضف المستخدم"}</button>
          <button className="btn btn-quiet" type="button" onClick={onClose}>إلغاء</button>
        </div>
      </form>
    </Dialog>
  );
}
