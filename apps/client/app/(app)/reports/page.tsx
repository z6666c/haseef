"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ApiError, BODY_TYPE_LABEL, LEGAL_TYPE_LABEL, OBLIGATION_STATUS_LABEL, PILLAR_LABEL, PLAN_LABEL, POSITION_LABEL,
  PRIORITY_LABEL, RESOLUTION_STATUS_LABEL, RESOLUTION_TYPE_LABEL, RISK4_LABEL, SIZE_LABEL, scoreTone,
  type BoardReport, type BoardReportResponse,
} from "@haseef/shared";
import { api } from "@/lib/session";

const fmt = (d: string | null, time = false) => d
  ? new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", time ? { dateStyle: "long", timeStyle: "short" } : { dateStyle: "long" }).format(new Date(d))
  : "—";
const PRIORITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const SEV = (s: string) => s.toUpperCase();
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

export default function ReportsPage() {
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => thisYear - i);
  const [year, setYear] = useState(thisYear);
  const [res, setRes] = useState<BoardReportResponse | null>(null);
  const [locked, setLocked] = useState(false);
  const [view, setView] = useState<"live" | "saved">("live");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((y: number, keepView = false) => {
    setRes(null); setError(null); setLocked(false);
    api.boardReport(y)
      .then((r) => {
        setRes(r);
        setNotes(r.saved?.notes ?? "");
        if (!keepView) setView(r.saved ? "saved" : "live");
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 402) setLocked(true);
        else setError(e instanceof Error ? e.message : "تعذّر تحميل التقرير");
      });
  }, []);
  useEffect(() => { load(year); }, [load, year]);

  async function save() {
    setBusy(true); setError(null); setNotice(null);
    try {
      await api.saveBoardReport(year, notes.trim() || null);
      setNotice(`حُفظت نسخة تقرير ${year}. تبقى ثابتة كما هي حتى لو تغيّرت البيانات لاحقاً.`);
      load(year, true);
      setView("saved");
    } catch (e) { setError(e instanceof Error ? e.message : "تعذّر الحفظ"); }
    finally { setBusy(false); }
  }

  const saved = res?.saved ?? null;
  const report = res ? (view === "saved" && saved ? saved.snapshot : res.live) : null;
  const shownNotes = view === "saved" && saved ? saved.notes : notes.trim() || null;

  return (
    <>
      <header className="page-head no-print">
        <h1>تقرير مجلس الإدارة السنوي</h1>
        <p className="muted">تقرير رسمي عن حالة الحوكمة والامتثال وحماية البيانات خلال السنة، يُعرض على المجلس أو الجمعية ويُحفظ نسخة ثابتة لكل سنة.</p>
      </header>

      <div className="report-toolbar no-print">
        <div className="field">
          <label htmlFor="ry">السنة</label>
          <select id="ry" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}{res?.saved_years.includes(y) ? " (محفوظ)" : ""}</option>)}
          </select>
        </div>
        {saved && (
          <div className="filters" role="tablist" aria-label="نسخة التقرير">
            <button type="button" role="tab" aria-selected={view === "saved"} aria-pressed={view === "saved"} onClick={() => setView("saved")}>النسخة المحفوظة</button>
            <button type="button" role="tab" aria-selected={view === "live"} aria-pressed={view === "live"} onClick={() => setView("live")}>البيانات الحالية</button>
          </div>
        )}
        {report && <button className="btn btn-quiet" type="button" onClick={() => window.print()}>طباعة / حفظ PDF</button>}
      </div>

      {notice && <p className="notice no-print" role="status">{notice}</p>}
      {error && <p className="error no-print" role="alert">{error}</p>}

      {locked ? (
        <div className="hint-box">
          <p><strong>تقرير مجلس الإدارة السنوي متاح في باقة كبار العملاء.</strong></p>
          <p>يجمع في وثيقة واحدة قابلة للطباعة: هيكل الحوكمة ونتيجة فحصه، القرارات والاجتماعات، التراخيص والسياسات،
            الالتزامات النظامية، حماية البيانات الشخصية، والتوصيات مرتبةً حسب الأولوية. تواصل مع فريق حصيف للترقية.</p>
        </div>
      ) : !report ? (
        !error && <div className="boot" aria-busy="true" />
      ) : (
        <>
          {view === "saved" && saved && (
            <p className="hint-box no-print">
              نسخة محفوظة بتاريخ {fmt(saved.saved_at, true)}{saved.saved_by_name ? ` بواسطة ${saved.saved_by_name}` : ""}.
              لا تتغيّر بتغيّر البيانات. للاطلاع على الوضع الحالي اختر «البيانات الحالية».
            </p>
          )}

          <Report r={report} notes={shownNotes} savedAt={view === "saved" && saved ? saved.saved_at : null} />

          {view === "live" && (
            <section className="panel report-save no-print">
              <h2>حفظ نسخة لهذه السنة</h2>
              <p className="small muted">تُحفظ صورة ثابتة من التقرير بالبيانات الحالية مع كلمة الإدارة، وتحلّ محل أي نسخة سابقة لسنة {year}.</p>
              <div className="field">
                <label htmlFor="rn">كلمة الإدارة / ملاحظات</label>
                <textarea id="rn" rows={5} value={notes} maxLength={5000} onChange={(e) => setNotes(e.target.value)}
                          placeholder="مثال: حققت المنشأة خلال العام تقدماً في استكمال هيكل الحوكمة، وتعمل الإدارة على…" />
              </div>
              <div className="form-actions">
                <button className="btn btn-action" type="button" disabled={busy} onClick={save}>{busy ? "جارٍ الحفظ…" : "حفظ نسخة لهذه السنة"}</button>
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}

function Report({ r, notes, savedAt }: { r: BoardReport; notes: string | null; savedAt: string | null }) {
  const tone = scoreTone(r.score.value);
  const recs = [...r.recommendations].sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9));
  const oblTotal = Object.entries(r.obligations.counts).filter(([k]) => k !== "NOT_APPLICABLE").reduce((s, [, n]) => s + n, 0);
  const oblDone = r.obligations.counts.IN_PLACE ?? 0;
  const membersTotal = r.structure.reduce((s, b) => s + b.members.length, 0);
  let n = 0;
  const sec = () => ++n;

  return (
    <article className="report" aria-label={`تقرير مجلس الإدارة لعام ${r.year}`}>
      <header className="report-cover">
        <p className="report-kicker">تقرير مجلس الإدارة السنوي عن الحوكمة والامتثال</p>
        <h1>{r.org.name}</h1>
        <p className="report-year">عن السنة المالية {r.year}</p>
        <dl className="report-meta">
          <div><dt>السجل التجاري</dt><dd dir="ltr">{r.org.cr_number}</dd></div>
          <div><dt>الكيان النظامي</dt><dd>{LEGAL_TYPE_LABEL[r.org.entity_legal_type] ?? r.org.entity_legal_type}</dd></div>
          {r.org.industry_type && <div><dt>القطاع</dt><dd>{r.org.industry_type}</dd></div>}
          {r.org.commercial_size && <div><dt>الحجم</dt><dd>{SIZE_LABEL[r.org.commercial_size] ?? r.org.commercial_size}</dd></div>}
          <div><dt>تاريخ الإعداد</dt><dd>{fmt(savedAt ?? r.generated_on)}</dd></div>
          {r.plan.tier && <div><dt>الباقة</dt><dd>{r.plan.name ?? PLAN_LABEL[r.plan.tier] ?? r.plan.tier}</dd></div>}
        </dl>
        <p className="small muted">أُعدّ هذا التقرير آلياً بمنصة حصيف من البيانات المسجلة لدى المنشأة، ويُعتمد بعد مراجعته من المجلس.</p>
      </header>

      <section className="report-sec">
        <h2>الملخص التنفيذي</h2>
        <div className="report-summary">
          <div className="report-score" data-tone={tone}>
            <span className="small muted">مؤشر حصافة</span>
            <b>{r.score.value ?? "—"}{r.score.value !== null && <small>%</small>}</b>
            {r.score.computed_at && <span className="small muted">حُسب في {fmt(r.score.computed_at)}</span>}
          </div>
          <dl className="report-pillars">
            {Object.entries(r.score.pillars).map(([k, v]) => (
              <div key={k}><dt>{PILLAR_LABEL[k as keyof typeof PILLAR_LABEL] ?? k}</dt>
                <dd><span className="score-pill" data-tone={scoreTone(v)}>{v ?? "—"}</span></dd></div>
            ))}
          </dl>
        </div>
        <dl className="kpi-grid">
          <div><dt>تراخيص ووثائق سارية</dt><dd>{r.compliance.active}<small> / {r.compliance.total}</small></dd></div>
          <div data-tone={r.compliance.expired ? "bad" : undefined}><dt>منتهية</dt><dd>{r.compliance.expired}</dd></div>
          <div><dt>نتيجة فحص الهيكل</dt><dd>{r.governance_check.structure_score !== null ? `${Math.round(r.governance_check.structure_score)}%` : "—"}</dd></div>
          <div><dt>قرارات موثقة</dt><dd>{r.resolutions.total}</dd></div>
          <div><dt>سياسات معتمدة</dt><dd>{r.policies.active}</dd></div>
          <div><dt>التزامات مستوفاة</dt><dd>{pct(oblDone, oblTotal)}</dd></div>
          <div><dt>أنشطة معالجة موثقة</dt><dd>{r.pdpl.records}</dd></div>
          <div data-tone={recs.some((x) => x.priority === "CRITICAL") ? "bad" : undefined}><dt>توصيات</dt><dd>{recs.length}</dd></div>
        </dl>
        {r.score.reasons.length > 0 && (
          <>
            <h3>أبرز ما يخفض المؤشر</h3>
            <ul className="report-list">
              {r.score.reasons.slice(0, 6).map((x, i) => (
                <li key={i}><span className="risk" data-r={SEV(x.severity)}>{RISK4_LABEL[SEV(x.severity)] ?? x.severity}</span> {x.text}
                  <span className="small muted"> — {PILLAR_LABEL[x.pillar as keyof typeof PILLAR_LABEL] ?? x.pillar}</span></li>
              ))}
            </ul>
          </>
        )}
      </section>

      {notes && (
        <section className="report-sec">
          <h2>كلمة الإدارة</h2>
          <p className="report-notes">{notes}</p>
        </section>
      )}

      <section className="report-sec">
        <h2><span>{sec()}</span> هيكل الحوكمة</h2>
        <p className="small muted">{r.structure.length} جهة حوكمة و{membersTotal} عضواً.</p>
        {r.structure.length === 0 ? <p className="empty">لم يُوثّق هيكل الحوكمة بعد.</p> : (
          <div className="report-bodies">
            {r.structure.map((b, i) => (
              <div key={i} className="report-body">
                <h3>{b.name} <span className="small muted">· {BODY_TYPE_LABEL[b.body_type] ?? b.body_type}
                  {b.meetings_per_year ? ` · ${b.meetings_per_year} اجتماعات سنوياً` : ""}</span></h3>
                {b.members.length === 0 ? <p className="small muted">لا أعضاء مسجلون.</p> : (
                  <table className="report-table">
                    <thead><tr><th>الاسم</th><th>المنصب</th><th>الصفة</th><th>نهاية العضوية</th></tr></thead>
                    <tbody>
                      {b.members.map((m, j) => (
                        <tr key={j}>
                          <td>{m.full_name}</td>
                          <td>{POSITION_LABEL[m.position] ?? m.position}</td>
                          <td>{[m.is_independent ? "مستقل" : null, m.is_executive ? "تنفيذي" : "غير تنفيذي"].filter(Boolean).join(" · ")}</td>
                          <td>{m.term_ends_on ? fmt(m.term_ends_on) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        )}

        <h3>فحص الحوكمة</h3>
        {r.governance_check.run_at === null ? <p className="small muted">لم يُجرَ فحص الحوكمة بعد.</p> : (
          <>
            <dl className="kpi-grid kpi-3">
              <div data-tone={scoreTone(r.governance_check.structure_score)}><dt>نتيجة الهيكل</dt>
                <dd>{r.governance_check.structure_score !== null ? `${Math.round(r.governance_check.structure_score)}%` : "—"}</dd></div>
              <div data-tone="good"><dt>معايير مستوفاة</dt><dd>{r.governance_check.passed}</dd></div>
              <div data-tone={r.governance_check.failed ? "bad" : undefined}><dt>فجوات</dt><dd>{r.governance_check.failed}</dd></div>
            </dl>
            <p className="small muted">آخر فحص: {fmt(r.governance_check.run_at)}</p>
            {r.governance_check.failed_items.length > 0 && (
              <table className="report-table">
                <thead><tr><th>المعيار</th><th>الملاحظة</th><th>الخطورة</th><th>المستوى</th></tr></thead>
                <tbody>
                  {r.governance_check.failed_items.map((f) => (
                    <tr key={f.code}>
                      <td><b>{f.title}</b><div className="small muted" dir="ltr">{f.code}</div></td>
                      <td>{f.message}</td>
                      <td><span className="risk" data-r={SEV(f.severity)}>{RISK4_LABEL[SEV(f.severity)] ?? f.severity}</span></td>
                      <td>{f.level === "MANDATORY" ? "إلزامي" : f.level === "RECOMMENDED" ? "ممارسة فضلى" : f.level}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>

      <section className="report-sec">
        <h2><span>{sec()}</span> القرارات والاجتماعات</h2>
        <dl className="kpi-grid">
          <div><dt>إجمالي القرارات</dt><dd>{r.resolutions.total}</dd></div>
          {Object.entries(r.resolutions.by_type).map(([k, v]) => (
            <div key={k}><dt>{RESOLUTION_TYPE_LABEL[k] ?? k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
        {r.resolutions.list.length > 0 && (
          <table className="report-table">
            <thead><tr><th>القرار</th><th>النوع</th><th>التاريخ</th><th>الحالة</th></tr></thead>
            <tbody>
              {r.resolutions.list.map((x, i) => (
                <tr key={i}><td>{x.title}</td><td>{RESOLUTION_TYPE_LABEL[x.resolution_type] ?? x.resolution_type}</td>
                  <td>{fmt(x.meeting_date)}</td><td>{RESOLUTION_STATUS_LABEL[x.status] ?? x.status}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        {r.meetings.length > 0 && (
          <>
            <h3>الاجتماعات: المطلوب مقابل المنعقد</h3>
            <table className="report-table">
              <thead><tr><th>الجهة</th><th>المطلوب سنوياً</th><th>المنعقد</th><th>الحالة</th></tr></thead>
              <tbody>
                {r.meetings.map((m, i) => {
                  const ok = m.held !== null && m.held >= m.required;
                  return (
                    <tr key={i}><td>{m.body} <span className="small muted">· {BODY_TYPE_LABEL[m.body_type] ?? m.body_type}</span></td>
                      <td>{m.required}</td><td>{m.held ?? "غير مسجل"}</td>
                      <td><span className="status-chip" data-s={ok ? "IN_PLACE" : m.held === null ? "PENDING" : "FAIL"}>
                        {ok ? "مستوفى" : m.held === null ? "لا بيانات" : "أقل من المطلوب"}</span></td></tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="report-sec">
        <h2><span>{sec()}</span> الامتثال التشغيلي: التراخيص والوثائق</h2>
        <dl className="kpi-grid">
          <div data-tone="good"><dt>سارية</dt><dd>{r.compliance.active}</dd></div>
          <div data-tone={r.compliance.expiring ? "warn" : undefined}><dt>قاربت على الانتهاء</dt><dd>{r.compliance.expiring}</dd></div>
          <div data-tone={r.compliance.expired ? "bad" : undefined}><dt>منتهية</dt><dd>{r.compliance.expired}</dd></div>
          <div><dt>جُدّدت خلال السنة</dt><dd>{r.compliance.renewed_in_year}</dd></div>
        </dl>
        {r.compliance.attention.length > 0 ? (
          <table className="report-table">
            <thead><tr><th>بنود تحتاج إجراء</th><th>تاريخ الانتهاء</th><th>الخطورة</th></tr></thead>
            <tbody>
              {r.compliance.attention.map((a, i) => (
                <tr key={i}><td>{a.title}</td><td>{fmt(a.expiry_date)}</td>
                  <td><span className="risk" data-r={a.risk_level}>{RISK4_LABEL[a.risk_level] ?? a.risk_level}</span></td></tr>
              ))}
            </tbody>
          </table>
        ) : <p className="small">لا بنود تحتاج إجراءً عاجلاً.</p>}
      </section>

      <section className="report-sec">
        <h2><span>{sec()}</span> السياسات الداخلية</h2>
        <dl className="kpi-grid">
          <div data-tone="good"><dt>معتمدة</dt><dd>{r.policies.active}</dd></div>
          <div><dt>اعتُمدت خلال السنة</dt><dd>{r.policies.approved_in_year}</dd></div>
          <div data-tone={r.policies.needs_review ? "warn" : undefined}><dt>تقترب مراجعتها</dt><dd>{r.policies.needs_review}</dd></div>
          <div data-tone={r.policies.overdue ? "bad" : undefined}><dt>فات موعد مراجعتها</dt><dd>{r.policies.overdue}</dd></div>
          <div><dt>مسودات</dt><dd>{r.policies.drafts}</dd></div>
        </dl>
      </section>

      <section className="report-sec">
        <h2><span>{sec()}</span> الالتزامات النظامية</h2>
        <dl className="kpi-grid">
          {Object.entries(r.obligations.counts).map(([k, v]) => (
            <div key={k} data-tone={k === "IN_PLACE" ? "good" : k === "AT_RISK" && v ? "bad" : k === "PENDING" && v ? "warn" : undefined}>
              <dt>{OBLIGATION_STATUS_LABEL[k] ?? k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
        {r.obligations.pending.length > 0 && (
          <table className="report-table">
            <thead><tr><th>التزامات لم تُستوفَ</th><th>الجهة</th><th>الخطورة</th></tr></thead>
            <tbody>
              {r.obligations.pending.map((o, i) => (
                <tr key={i}><td>{o.title}</td><td>{o.authority ?? "—"}</td>
                  <td><span className="risk" data-r={o.risk_level}>{RISK4_LABEL[o.risk_level] ?? o.risk_level}</span></td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="report-sec">
        <h2><span>{sec()}</span> حماية البيانات الشخصية</h2>
        <dl className="kpi-grid">
          <div data-tone={r.pdpl.records ? "good" : "warn"}><dt>أنشطة معالجة موثقة</dt><dd>{r.pdpl.records}</dd></div>
          <div><dt>طلبات أصحاب البيانات</dt><dd>{r.pdpl.requests.total}</dd></div>
          <div data-tone={r.pdpl.requests.total && r.pdpl.requests.on_time < r.pdpl.requests.total - r.pdpl.requests.open ? "warn" : undefined}>
            <dt>طلبات رُدّ عليها في المهلة</dt><dd>{r.pdpl.requests.on_time}<small> ({pct(r.pdpl.requests.on_time, r.pdpl.requests.total - r.pdpl.requests.open)})</small></dd></div>
          <div><dt>حوادث التسرب</dt><dd>{r.pdpl.incidents.total}</dd></div>
          <div data-tone={r.pdpl.incidents.notified_in_time < r.pdpl.incidents.harm_likely ? "bad" : undefined}>
            <dt>أُبلغ عنها خلال 72 ساعة</dt><dd>{r.pdpl.incidents.notified_in_time}<small> من {r.pdpl.incidents.harm_likely} تستوجب الإبلاغ</small></dd></div>
          <div><dt>تقييمات الأثر (DPIA)</dt><dd>{r.pdpl.dpia.total}<small> · {r.pdpl.dpia.approved} معتمد</small></dd></div>
          <div data-tone={r.pdpl.dpia.high_residual ? "bad" : undefined}><dt>عالية الخطر المتبقي</dt><dd>{r.pdpl.dpia.high_residual}</dd></div>
        </dl>
        {(r.pdpl.requests.open > 0 || r.pdpl.incidents.open > 0) && (
          <p className="small">مفتوح حالياً: {r.pdpl.requests.open} طلب و{r.pdpl.incidents.open} حادثة.</p>
        )}
      </section>

      <section className="report-sec">
        <h2><span>{sec()}</span> الاستشارات القانونية</h2>
        <dl className="kpi-grid kpi-3">
          <div><dt>استشارات مكتملة</dt><dd>{r.legal.completed}</dd></div>
          <div><dt>قيد التنفيذ</dt><dd>{r.legal.open}</dd></div>
        </dl>
        <p className="small muted">قدّمها محامون مستقلون مرخصون عبر منصة حصيف.</p>
      </section>

      <section className="report-sec">
        <h2><span>{sec()}</span> التوصيات</h2>
        {recs.length === 0 ? <p className="small">لا توصيات: الوضع مستوفٍ وفق البيانات المسجلة.</p> : (
          <table className="report-table">
            <thead><tr><th>#</th><th>الأولوية</th><th>المجال</th><th>التوصية</th></tr></thead>
            <tbody>
              {recs.map((x, i) => (
                <tr key={i}><td>{i + 1}</td>
                  <td><span className="risk" data-r={x.priority}>{PRIORITY_LABEL[x.priority] ?? x.priority}</span></td>
                  <td>{x.area}</td><td>{x.text}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="report-sec report-sign">
        <h2>الاعتماد</h2>
        <p className="small">اطّلع المجلس على هذا التقرير واعتمده في اجتماعه المنعقد بتاريخ ____ / ____ / ________</p>
        <div className="sign-grid">
          {["رئيس مجلس الإدارة", "أمين سر المجلس"].map((role) => (
            <div key={role} className="sign-box">
              <p><b>{role}</b></p>
              <p>الاسم: ________________________</p>
              <p>التوقيع: ______________________</p>
              <p>التاريخ: ______________________</p>
            </div>
          ))}
        </div>
      </section>
    </article>
  );
}
