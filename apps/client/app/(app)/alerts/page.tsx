"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ALERT_CHANNEL_LABEL, DISPATCH_STATUS_LABEL, ORG_ROLE_LABEL, countDays, formatDate,
  type AlertRuleView, type AlertsOverview,
} from "@haseef/shared";
import { AlertPreview } from "@/components/AlertPreview";
import { api } from "@/lib/session";

type Target = "COMPLIANCE_ITEM" | "POLICY";
type Channel = "WHATSAPP" | "EMAIL";

const DAY_OPTIONS = [90, 60, 45, 30, 14, 7, 3, 1, 0];
const CHANNELS: Channel[] = ["WHATSAPP", "EMAIL"];
const TARGET_LABEL: Record<string, string> = { COMPLIANCE_ITEM: "التراخيص والوثائق", POLICY: "مراجعة السياسات" };
const TARGET_HINT: Record<string, string> = {
  COMPLIANCE_ITEM: "تذكير قبل انتهاء السجل التجاري والرخص والشهادات وكل وثيقة لها تاريخ انتهاء.",
  POLICY: "تذكير قبل موعد المراجعة الدورية لكل سياسة معتمدة.",
};
const DISPATCH_TONE: Record<string, string> = {
  SENT: "IN_PLACE", DELIVERED: "IN_PLACE", READ: "IN_PLACE", QUEUED: "PENDING", SENDING: "PENDING", FAILED: "FAIL",
};
const fmtTime = (d: string | null) => d
  ? new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" }).format(new Date(d))
  : "—";
const threshold = (n: number) => (n === 0 ? "يوم الانتهاء" : n < 0 ? `بعد الانتهاء بـ${countDays(-n)}` : `قبل ${countDays(n)}`);
const hourLabel = (h: number) => {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:00 ${h < 12 ? "صباحاً" : "مساءً"}`;
};

export default function AlertsPage() {
  const [ov, setOv] = useState<AlertsOverview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("منشأتك");
  useEffect(() => { api.dashboard().then((d) => setOrgName(d.org_name)).catch(() => {}); }, []);

  const load = useCallback(() => { api.alertsOverview().then(setOv).catch((e: Error) => setError(e.message)); }, []);
  useEffect(load, [load]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setError(null); setNotice(null);
    try { await fn(); setNotice(ok); load(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "تعذّر الحفظ"); return false; }
  }

  if (!ov) return error ? <p className="error" role="alert">{error}</p> : <div className="boot" aria-busy="true" />;
  const wa = ov.whatsapp;
  const pct = wa.limit ? Math.min(100, Math.round((wa.used / wa.limit) * 100)) : 0;

  return (
    <>
      <header className="page-head">
        <h1>التنبيهات والواتساب</h1>
        <p className="muted">تذكيرات تلقائية قبل انتهاء التراخيص والوثائق ومواعيد مراجعة السياسات، تصل بالبريد الإلكتروني وواتساب
          للمستلمين الذين تحددهم. تُرسل يومياً الساعة {hourLabel(ov.send_hour)} بتوقيت الرياض.</p>
      </header>
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {!ov.plan.active && (
        <p className="hint-box">التنبيهات التلقائية متوقفة لأن اشتراك المنشأة غير فعّال. تبقى الإعدادات محفوظة وتعود للعمل فور التفعيل.</p>
      )}

      <section className="alert-status">
        <div className="panel">
          <h2 className="small muted">قناة واتساب</h2>
          {wa.provider === "console" || !wa.live ? (
            <p><span className="draft-badge">وضع تجريبي: الرسائل لا تُرسل فعلياً حتى اعتماد القوالب لدى Meta</span></p>
          ) : (
            <p><span className="status-chip" data-s="IN_PLACE">مفعّلة ومتصلة</span></p>
          )}
          <p className="small muted">المزود: <span dir="ltr">{wa.provider}</span></p>
        </div>
        <div className="panel">
          <h2 className="small muted">رسائل واتساب هذا الشهر</h2>
          {wa.limit === null ? (
            <p className="quota-num"><b>{wa.used}</b> <span className="muted">مرسلة · غير محدود</span></p>
          ) : (
            <>
              <p className="quota-num"><b>{wa.used}</b> <span className="muted">من {wa.limit}</span></p>
              <div className="quota-bar" role="progressbar" aria-valuemin={0} aria-valuemax={wa.limit} aria-valuenow={wa.used}
                   aria-label="استهلاك حصة واتساب" data-tone={pct >= 90 ? "bad" : pct >= 70 ? "warn" : "good"}>
                <span style={{ width: `${pct}%` }} />
              </div>
              <p className="small muted">المتبقي {wa.remaining ?? 0} رسالة. عند نفاد الحصة تستمر التنبيهات بالبريد الإلكتروني.</p>
            </>
          )}
        </div>
        <div className="panel">
          <h2 className="small muted">وقت الإرسال</h2>
          <p className="quota-num"><b>{hourLabel(ov.send_hour)}</b></p>
          <p className="small muted">بتوقيت الرياض، مرة يومياً لكل موعد مستحق.</p>
        </div>
      </section>

      <AlertPreview ov={ov} orgName={orgName} />

      <section className="gov-section">
        <div className="section-head">
          <h2>قواعد التنبيه</h2>
          {!ov.can_manage && <p className="muted">يعدّلها مدير المنشأة أو مسؤول الامتثال.</p>}
        </div>
        <div className="rule-grid">
          {(["COMPLIANCE_ITEM", "POLICY"] as Target[]).map((t) => (
            <RuleEditor key={t + JSON.stringify(ov.rules[t])} target={t} rule={ov.rules[t]} canManage={ov.can_manage}
              onSave={(r) => act(() => api.setAlertRule({ target_type: t, target_id: null, ...r }), `حُفظت قاعدة ${TARGET_LABEL[t]}`)} />
          ))}
        </div>
        {ov.custom_rules > 0 && <p className="small muted">إضافة إلى {ov.custom_rules} قاعدة خاصة بعناصر بعينها تتقدّم على القاعدة العامة.</p>}
      </section>

      <section className="gov-section">
        <div className="section-head">
          <h2>المستلمون</h2>
          <p className="muted">{ov.can_manage ? "حدد من يتلقى التنبيهات وعلى أي قناة." : "تستطيع ضبط تنبيهاتك أنت فقط."}</p>
        </div>
        <table className="deadlines recip-table">
          <thead><tr><th>العضو</th><th>يتلقى التنبيهات</th><th>القنوات</th></tr></thead>
          <tbody>
            {ov.recipients.map((r) => {
              const editable = ov.can_manage || r.is_me;
              const ch = r.alert_channels as Channel[];
              const save = (receives: boolean, channels: Channel[]) =>
                act(() => api.setRecipient(r.membership_id, { receives_alerts: receives, alert_channels: channels }), `حُفظت إعدادات ${r.full_name}`);
              return (
                <tr key={r.membership_id}>
                  <td>
                    <strong>{r.full_name}</strong>{r.is_me && <span className="tag tag-quiet"> أنت</span>}
                    <div className="small muted">{ORG_ROLE_LABEL[r.role] ?? r.role}</div>
                    <div className="small muted"><span dir="ltr">{r.email ?? "—"}</span> · <span dir="ltr">{r.phone ?? "لا رقم جوال"}</span></div>
                  </td>
                  <td>
                    <label className="switch">
                      <input type="checkbox" checked={r.receives_alerts} disabled={!editable}
                             onChange={(e) => save(e.target.checked, ch)} />
                      <span>{r.receives_alerts ? "نعم" : "لا"}</span>
                    </label>
                  </td>
                  <td>
                    <div className="checks-inline">
                      {CHANNELS.map((c) => (
                        <label key={c}>
                          <input type="checkbox" checked={ch.includes(c)} disabled={!editable || !r.receives_alerts}
                                 onChange={(e) => {
                                   const next = e.target.checked ? [...ch, c] : ch.filter((x) => x !== c);
                                   if (next.length) save(r.receives_alerts, next);
                                   else setError("اختر قناة واحدة على الأقل، أو أوقف التنبيهات لهذا العضو.");
                                 }} />
                          {ALERT_CHANNEL_LABEL[c]}
                        </label>
                      ))}
                    </div>
                    {r.receives_alerts && ch.includes("WHATSAPP") && !r.phone && (
                      <p className="small late">لا يوجد رقم جوال لهذا العضو، فلن تصله رسائل واتساب. أضف الرقم من الملف الشخصي.</p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="gov-section">
        <div className="section-head">
          <h2>التنبيهات القادمة</h2>
          <p className="muted">خلال الستين يوماً القادمة حسب القواعد الحالية.</p>
        </div>
        {ov.upcoming.length === 0 ? (
          <p className="empty">لا تنبيهات مجدولة خلال الستين يوماً القادمة.</p>
        ) : (
          <table className="deadlines">
            <thead><tr><th>موعد التنبيه</th><th>العنصر</th><th>التوقيت</th><th>القنوات</th></tr></thead>
            <tbody>
              {ov.upcoming.map((u) => (
                <tr key={`${u.target_id}-${u.threshold_days}`}>
                  <td><b>{formatDate(u.alert_on)}</b></td>
                  <td>
                    <Link href={u.target_type === "POLICY" ? `/policies/view?id=${u.target_id}` : "/licenses"}>{u.title}</Link>
                    <div className="small muted">{TARGET_LABEL[u.target_type] ?? u.target_type} · الاستحقاق {formatDate(u.due_date)}</div>
                  </td>
                  <td>{threshold(u.threshold_days)}</td>
                  <td>{u.channels.map((c) => ALERT_CHANNEL_LABEL[c] ?? c).join("، ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="gov-section">
        <div className="section-head">
          <h2>سجل الإرسال</h2>
          <p className="muted">آخر الرسائل المرسلة أو المجدولة وحالتها.</p>
        </div>
        {ov.log.length === 0 ? (
          <p className="empty">لم يُرسل أي تنبيه بعد.</p>
        ) : (
          <table className="deadlines">
            <thead><tr><th>العنصر</th><th>المستلم</th><th>القناة</th><th>الحالة</th><th>الوقت</th></tr></thead>
            <tbody>
              {ov.log.map((l) => (
                <tr key={l.id}>
                  <td>{l.title ?? TARGET_LABEL[l.target_type] ?? "—"}
                    <div className="small muted">{threshold(l.threshold_days)} · الاستحقاق {formatDate(l.due_date)}</div></td>
                  <td>{l.recipient_name ?? "—"}</td>
                  <td>{ALERT_CHANNEL_LABEL[l.channel] ?? l.channel}</td>
                  <td>
                    <span className="status-chip" data-s={DISPATCH_TONE[l.status]}>{DISPATCH_STATUS_LABEL[l.status] ?? l.status}</span>
                    {l.skip_reason && <div className="small muted">{l.skip_reason}</div>}
                  </td>
                  <td className="small">{fmtTime(l.delivered_at ?? l.sent_at ?? l.scheduled_for)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function RuleEditor({ target, rule, canManage, onSave }: {
  target: Target; rule: AlertRuleView; canManage: boolean;
  onSave: (r: { days_before: number[]; channels: string[]; is_enabled: boolean }) => Promise<boolean>;
}) {
  const [days, setDays] = useState<number[]>(rule.days_before);
  const [channels, setChannels] = useState<string[]>(rule.channels);
  const [enabled, setEnabled] = useState(rule.is_enabled);
  const [busy, setBusy] = useState(false);
  const dirty = enabled !== rule.is_enabled
    || [...days].sort().join() !== [...rule.days_before].sort().join()
    || [...channels].sort().join() !== [...rule.channels].sort().join();
  const valid = !enabled || (days.length > 0 && channels.length > 0);
  const ro = !canManage;

  async function save() {
    setBusy(true);
    await onSave({ days_before: [...days].sort((a, b) => b - a), channels, is_enabled: enabled });
    setBusy(false);
  }

  return (
    <div className="panel rule-card" data-on={enabled}>
      <div className="rule-head">
        <div>
          <h3>{TARGET_LABEL[target]}</h3>
          <p className="small muted">{TARGET_HINT[target]}</p>
        </div>
        <label className="switch">
          <input type="checkbox" checked={enabled} disabled={ro} onChange={(e) => setEnabled(e.target.checked)} />
          <span>{enabled ? "مفعّلة" : "متوقفة"}</span>
        </label>
      </div>
      <fieldset className="day-chips" disabled={ro || !enabled}>
        <legend className="small muted">متى يصل التنبيه</legend>
        {DAY_OPTIONS.map((d) => (
          <button key={d} type="button" aria-pressed={days.includes(d)}
                  onClick={() => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d])}>
            {d === 0 ? "يوم الانتهاء" : countDays(d)}
          </button>
        ))}
      </fieldset>
      <fieldset className="checks" disabled={ro || !enabled}>
        <legend className="small muted">القنوات</legend>
        <div className="checks-inline">
          {CHANNELS.map((c) => (
            <label key={c}>
              <input type="checkbox" checked={channels.includes(c)}
                     onChange={(e) => setChannels(e.target.checked ? [...channels, c] : channels.filter((x) => x !== c))} />
              {ALERT_CHANNEL_LABEL[c]}
            </label>
          ))}
        </div>
      </fieldset>
      {rule.is_default && <p className="small muted">تعمل الآن بالإعداد الافتراضي لحصيف.</p>}
      {!valid && <p className="small error">اختر موعداً واحداً وقناة واحدة على الأقل.</p>}
      {canManage && (
        <div className="form-actions">
          <button className="btn btn-action" type="button" disabled={!dirty || !valid || busy} onClick={save}>{busy ? "جارٍ الحفظ…" : "حفظ القاعدة"}</button>
          {dirty && <button className="btn btn-quiet" type="button" onClick={() => { setDays(rule.days_before); setChannels(rule.channels); setEnabled(rule.is_enabled); }}>تراجع</button>}
        </div>
      )}
    </div>
  );
}
