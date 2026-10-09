"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ALERT_CHANNEL_LABEL, DISPATCH_STATUS_LABEL, ORG_ROLE_LABEL, countDays, formatDate,
  type AlertRuleView, type AlertTargetType, type AlertsOverview,
} from "@haseef/shared";
import { AlertPreview } from "@/components/AlertPreview";
import { api } from "@/lib/session";

type Target = AlertTargetType;
type Channel = "WHATSAPP" | "EMAIL";

const DAY_OPTIONS = [90, 60, 45, 30, 14, 7, 3, 1, 0];
const CHANNELS: Channel[] = ["WHATSAPP", "EMAIL"];
const TARGET_LABEL: Record<string, string> = {
  COMPLIANCE_ITEM: "التراخيص والوثائق", POLICY: "مراجعة السياسات", EMPLOYEE_DOC: "وثائق الموظفين", LABOR_TASK: "التأمينات وحماية الأجور والرواتب",
  IQAMA: "الإقامات", WORK_PERMIT: "رخص العمل", CONTRACT_END: "عقود العمل", PROBATION_END: "فترات التجربة",
  TAX_TASK: "الزكاة والضريبة",
};
const LABOR_TARGETS = new Set(["LABOR_TASK", "IQAMA", "WORK_PERMIT", "CONTRACT_END", "PROBATION_END"]);
const targetHref = (type: string, id: string) =>
  type === "POLICY" ? `/policies/view?id=${id}` : type === "TAX_TASK" ? "/tax" : LABOR_TARGETS.has(type) ? "/labor" : "/licenses";
const TARGET_HINT: Record<string, string> = {
  COMPLIANCE_ITEM: "تذكير قبل انتهاء السجل التجاري والرخص والشهادات وكل وثيقة لها تاريخ انتهاء.",
  POLICY: "تذكير قبل موعد المراجعة الدورية لكل سياسة معتمدة.",
  EMPLOYEE_DOC: "تذكير قبل انتهاء إقامات الموظفين ورخص العمل وعقود العمل المحددة المدة وفترات التجربة.",
  LABOR_TASK: "تذكير قبل موعد سداد التأمينات (15 من الشهر التالي) ورفع ملف الأجور في مُدد وصرف الرواتب، حتى تأكيد الإنجاز.",
  TAX_TASK: "تذكير قبل مواعيد إقرارات القيمة المضافة والاستقطاع والزكاة، حتى تأكيد التقديم.",
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
        <p className="muted">تذكيرات تلقائية قبل انتهاء التراخيص والوثائق ومواعيد مراجعة السياسات والتزامات العمل (التأمينات، حماية الأجور، الإقامات)، تصل بالبريد الإلكتروني وواتساب
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

      <CalendarSync canManage={ov.can_manage} />

      <section className="gov-section">
        <div className="section-head">
          <h2>قواعد التنبيه</h2>
          {!ov.can_manage && <p className="muted">يعدّلها مدير المنشأة أو مسؤول الامتثال.</p>}
        </div>
        <div className="rule-grid">
          {(["COMPLIANCE_ITEM", "POLICY", "EMPLOYEE_DOC", "LABOR_TASK", "TAX_TASK"] as Target[]).filter((t) => ov.rules[t]).map((t) => (
            <RuleEditor key={t + JSON.stringify(ov.rules[t])} target={t} rule={ov.rules[t]!} canManage={ov.can_manage}
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
                    <Link href={targetHref(u.target_type, u.target_id)}>{u.title}</Link>
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

/** مزامنة المواعيد مع تقويم جوجل وأوتلوك والآيفون (رابط اشتراك سري). */
function CalendarSync({ canManage }: { canManage: boolean }) {
  const [st, setSt] = useState<{ active: boolean; include_people?: boolean; created_at?: string } | null>(null);
  const [people, setPeople] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [ics, setIcs] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { api.calendarFeed().then((x) => { setSt(x); setPeople(!!x.include_people); }).catch(() => {}); }, []);
  useEffect(load, [load]);
  if (!st) return null;
  async function create() {
    setErr(null);
    try { const r = await api.createCalendarFeed(people); setUrl(r.url); setIcs(r.ics ?? null); load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "تعذّر"); }
  }
  return (
    <section className="gov-section">
      <div className="section-head">
        <h2>مزامنة التقويم</h2>
        <p className="muted">كل مواعيدك (التراخيص، السياسات، التأمينات والأجور، الزكاة والضريبة) في تقويم جوجل أو أوتلوك أو الآيفون، وتتحدث تلقائياً.</p>
      </div>
      {url ? (
        <div className="panel inline-form">
          <p className="small"><b>انسخ الرابط الآن</b> — لن يظهر مرة أخرى. في تقويم جوجل: «إضافة تقويم» ← «من عنوان URL». في الآيفون: الإعدادات ← التقويم ← الحسابات ← إضافة تقويم مشترك.</p>
          <div className="feed-url"><input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
            <button className="btn btn-quiet btn-xs" type="button" onClick={() => navigator.clipboard?.writeText(url)}>نسخ</button></div>
          {ics && <a className="btn btn-quiet btn-xs" download="haseef.ics" href={`data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`}>تنزيل ملف التقويم (.ics)</a>}
        </div>
      ) : st.active ? (
        <p className="small">رابط التقويم مفعّل منذ {st.created_at ? fmtTime(st.created_at) : "—"}{st.include_people ? " ويتضمن أسماء الموظفين" : " دون أسماء الموظفين"}.</p>
      ) : <p className="small muted">لا يوجد رابط تقويم بعد.</p>}
      {canManage && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
          <label className="checks-inline"><input type="checkbox" checked={people} onChange={(e) => setPeople(e.target.checked)} /> إظهار أسماء الموظفين في التقويم الخارجي</label>
          <button className="btn btn-action btn-xs" type="button" onClick={create}>{st.active ? "إنشاء رابط جديد (يُبطل السابق)" : "إنشاء رابط التقويم"}</button>
          {st.active && <button className="btn btn-quiet btn-xs" type="button" onClick={() => api.deleteCalendarFeed().then(() => { setUrl(null); load(); })}>إيقاف الرابط</button>}
        </div>
      )}
      {err && <p className="error">{err}</p>}
    </section>
  );
}
