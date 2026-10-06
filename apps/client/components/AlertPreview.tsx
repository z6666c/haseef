"use client";

import { useMemo, useState } from "react";
import {
  LABOR_TARGETS, WA_TEMPLATES, countDays, formatDate, renderTemplate, templateFor, templateVars, type AlertsOverview,
} from "@haseef/shared";

type Sample = { key: string; label: string; target_type: string; title: string; due_date: string; days_left: number };

const DAY = 86_400_000;
const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);
const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);     // الرياض
const hour = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "ص" : "م"}`;

/** معاينة الرسائل كما تصل للمستلم، وشرح آلية التنبيه، مبنية على بيانات المنشأة الفعلية. */
export function AlertPreview({ ov, orgName }: { ov: AlertsOverview; orgName: string }) {
  const me = ov.recipients.find((r) => r.is_me) ?? ov.recipients[0];
  const samples: Sample[] = useMemo(() => {
    const fromUpcoming = ov.upcoming.slice(0, 6).map((u, i) => ({
      key: `u${i}`, label: `${u.title} (تنبيه ${formatDate(u.alert_on)})`, target_type: u.target_type,
      title: u.title, due_date: u.due_date, days_left: u.threshold_days,
    }));
    const t = today();
    const fixed: Sample[] = [
      { key: "s1", label: "مثال: ترخيص ينتهي بعد 7 أيام", target_type: "COMPLIANCE_ITEM", title: "رخصة بلدي — الفرع الرئيسي", due_date: addDays(t, 7), days_left: 7 },
      { key: "s2", label: "مثال: ترخيص انتهى منذ يومين", target_type: "COMPLIANCE_ITEM", title: "شهادة الدفاع المدني", due_date: addDays(t, -2), days_left: -2 },
      { key: "s3", label: "مثال: سياسة مستحقة المراجعة بعد 14 يوماً", target_type: "POLICY", title: "سياسة الخصوصية", due_date: addDays(t, 14), days_left: 14 },
      { key: "s4", label: "مثال: سداد التأمينات بعد 5 أيام", target_type: "LABOR_TASK", title: "سداد اشتراكات التأمينات الاجتماعية", due_date: addDays(t, 5), days_left: 5 },
      { key: "s5", label: "مثال: إقامة موظف تنتهي بعد 30 يوماً", target_type: "IQAMA", title: "انتهاء الإقامة — محمد رفيق", due_date: addDays(t, 30), days_left: 30 },
    ];
    return [...fromUpcoming, ...fixed];
  }, [ov.upcoming]);
  const [sel, setSel] = useState(samples[0]?.key ?? "s1");
  const s = samples.find((x) => x.key === sel) ?? samples[0];

  const tpl = templateFor(s.target_type, s.days_left);
  const labor = LABOR_TARGETS.has(s.target_type);
  const link = s.target_type === "POLICY" ? "https://app.haseef.sa/policies" : labor ? "https://app.haseef.sa/labor" : "https://app.haseef.sa/licenses";
  const vars = templateVars({ recipient: me?.full_name?.split(" ")[0] ?? "أحمد", title: s.title, orgName, dueDate: s.due_date, daysLeft: s.days_left, link });
  const text = renderTemplate(tpl, vars);
  const rule = ov.rules[s.target_type === "POLICY" ? "POLICY" : s.target_type === "LABOR_TASK" ? "LABOR_TASK" : labor ? "EMPLOYEE_DOC" : "COMPLIANCE_ITEM"]
    ?? ov.rules.COMPLIANCE_ITEM;
  const thresholds = [...rule.days_before].sort((a, b) => b - a);
  const t0 = today();
  const subject = tpl === "haseef_license_expired" ? `عاجل: انتهت صلاحية ${s.title}`
    : tpl === "haseef_policy_review_due" ? `تذكير: مراجعة ${s.title} ${vars[3]}`
    : tpl === "haseef_labor_due" ? `تذكير: ${s.title} مستحق ${vars[3]}` : `تنبيه: ${s.title} تنتهي ${vars[3]}`;

  return (
    <section className="gov-section">
      <div className="section-head">
        <h2>معاينة الرسائل وطريقة عملها</h2>
        <p className="muted">هكذا تصل الرسالة لـ{me?.full_name ?? "المستلم"} على واتساب والبريد، بالقالب المعتمد نفسه وبيانات منشأتك.</p>
      </div>

      <div className="field" style={{ maxWidth: 520 }}>
        <label htmlFor="pv">اختر عنصراً للمعاينة</label>
        <select id="pv" value={sel} onChange={(e) => setSel(e.target.value)}>
          {samples.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
      </div>

      <div className="pv-grid">
        <div className="pv-phone" aria-label="معاينة رسالة واتساب">
          <div className="pv-top"><span className="pv-avatar">ح</span><div><b>حصيف <span className="pv-verified">✓</span></b><small>حساب أعمال</small></div></div>
          <div className="pv-chat">
            <span className="pv-day">اليوم</span>
            <div className="pv-bubble">
              <p>{text}</p>
              <small className="pv-footer">{WA_TEMPLATES[tpl].footer}</small>
              <small className="pv-time">{hour(ov.send_hour)}</small>
            </div>
          </div>
          <p className="pv-cap small muted">القالب: <span dir="ltr">{tpl}</span> — {WA_TEMPLATES[tpl].title}</p>
        </div>

        <div className="pv-mail" aria-label="معاينة البريد الإلكتروني">
          <div className="pv-mail-head">
            <p><span className="muted">من:</span> حصيف &lt;<span dir="ltr">alerts@haseef.sa</span>&gt;</p>
            <p><span className="muted">إلى:</span> <span dir="ltr">{me?.email ?? "you@company.sa"}</span></p>
            <p><span className="muted">الموضوع:</span> <b>{subject}</b></p>
          </div>
          <div className="pv-mail-body">
            {text.split("\n").map((line, i) => <p key={i}>{line}</p>)}
            <a className="btn btn-action" href="#" onClick={(e) => e.preventDefault()}>{s.target_type === "POLICY" ? "افتح السياسة" : labor ? "افتح العمل والموظفين" : "افتح الترخيص في حصيف"}</a>
          </div>
        </div>
      </div>

      <h3>متى يصل التنبيه لهذا العنصر؟</h3>
      <ol className="pv-timeline">
        {thresholds.map((th) => {
          const on = addDays(s.due_date, -th);
          const state = on < t0 ? "past" : on === t0 ? "today" : "next";
          return (
            <li key={th} data-s={state}>
              <b>{th === 0 ? "يوم الانتهاء" : `قبل ${countDays(th)}`}</b>
              <span>{formatDate(on)}</span>
              <small>{state === "past" ? "مضى (لا يُعاد إرساله)" : state === "today" ? "يُرسل اليوم" : "قادم"}</small>
            </li>
          );
        })}
      </ol>

      <h3>كيف تعمل التنبيهات</h3>
      <ol className="pv-steps">
        <li><b>كل ليلة</b> يفحص حصيف تواريخ كل التراخيص والسياسات، ويحدد ما عبر موعداً من مواعيد التنبيه ({thresholds.map((x) => x).join("، ")} يوماً).</li>
        <li><b>الساعة {hour(ov.send_hour)}</b> بتوقيت الرياض تُرسل الرسائل لكل مستلم مفعّل، على القنوات التي اختارها (واتساب و/أو البريد).</li>
        <li><b>رسالة واحدة لكل موعد:</b> لا تتكرر الرسالة للموعد نفسه، وإن فات أكثر من موعد دفعة واحدة تُرسل رسالة واحدة لأقربها فقط.</li>
        <li><b>بعد التجديد</b> وتحديث تاريخ الانتهاء في حصيف تبدأ دورة تنبيهات جديدة للتاريخ الجديد تلقائياً.</li>
        <li><b>حصة واتساب:</b> عند نفاد حصة الباقة الشهرية تستمر التنبيهات بالبريد الإلكتروني حتى بداية الشهر التالي.</li>
        <li><b>بلا اشتراك فعّال</b> تتوقف التنبيهات التلقائية، ويبقى التذكير اليدوي من صفحة التراخيص متاحاً.</li>
      </ol>
      {(ov.whatsapp.provider === "console" || !ov.whatsapp.live) && (
        <p className="hint-box">الإرسال الفعلي على واتساب يبدأ بعد اعتماد القوالب الثلاثة لدى Meta وربط الحساب. المعاينة أعلاه مطابقة لما سيصل حرفياً.</p>
      )}
    </section>
  );
}
