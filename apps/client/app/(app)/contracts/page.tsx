"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  CONTRACT_KIND_LABEL, CONTRACT_VERDICT_LABEL, PII_LABEL, SAMPLE_CONTRACTS, checkContract, guessContractKind,
  type ContractCheckResult, type ContractKind,
} from "@haseef/shared";

const TONE = { COMPLIANT: "good", CONTAINS_VIOLATIONS: "warn", HIGH_RISK: "bad" } as const;

export default function ContractsPage() {
  const [text, setText] = useState(SAMPLE_CONTRACTS[0].text);
  const [kind, setKind] = useState<ContractKind>(SAMPLE_CONTRACTS[0].kind);
  const [sample, setSample] = useState(SAMPLE_CONTRACTS[0].id);
  const [res, setRes] = useState<ContractCheckResult | null>(null);
  const [showRedacted, setShowRedacted] = useState(false);
  const [msg, alertMsg] = useState<string | null>(null);

  const pickSample = (id: string) => {
    setSample(id); setRes(null);
    const s = SAMPLE_CONTRACTS.find((x) => x.id === id);
    if (s) { setText(s.text); setKind(s.kind); } else { setText(""); }
  };
  async function loadFile(f: File | undefined) {
    if (!f) return;
    if (!/\.(txt|md)$/i.test(f.name) && f.type !== "text/plain") { alertMsg("ارفع ملفاً نصياً (.txt) أو الصق النص مباشرة. دعم PDF وWord يأتي مع المرحلة الثانية."); return; }
    const t = await f.text();
    setText(t); setKind(guessContractKind(t)); setSample(""); setRes(null);
  }
  const run = () => { alertMsg(null); setRes(checkContract(text, kind)); setShowRedacted(false); };

  const counts = useMemo(() => res ? {
    v: res.findings.filter((f) => f.severity === "VIOLATION").length,
    w: res.findings.filter((f) => f.severity === "WARNING").length,
  } : null, [res]);
  const pii = res ? Object.entries(res.redaction.counts) : [];

  return (
    <>
      <header className="page-head">
        <h1>فاحص العقود</h1>
        <p className="muted">الصق نص عقد عمل أو سياسة خصوصية، أو جرّب أحد الأمثلة، وسيُظهر الفاحص البنود المخالفة لنظام العمل
          ونظام حماية البيانات الشخصية مع رقم المادة والصياغة البديلة. <b>الفحص يتم داخل متصفحك ولا يُرسَل نص العقد لأي خادم.</b></p>
      </header>
      <p className="hint-box">نسخة تجريبية: الفحص الحالي بقواعد ثابتة تلتقط الصياغات الشائعة. التحليل العميق بالذكاء الاصطناعي يُفعَّل بعد اعتماد مزوّد داخل المملكة،
        وتُحجب البيانات الشخصية قبله تلقائياً كما ترى في النتيجة.</p>

      <section className="contract-input">
        <div className="contract-tools">
          <div className="field">
            <label htmlFor="c-sample">مثال تجريبي</label>
            <select id="c-sample" value={sample} onChange={(e) => pickSample(e.target.value)}>
              {SAMPLE_CONTRACTS.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              <option value="">نص من عندي</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="c-kind">نوع الوثيقة</label>
            <select id="c-kind" value={kind} onChange={(e) => { setKind(e.target.value as ContractKind); setRes(null); }}>
              {(Object.keys(CONTRACT_KIND_LABEL) as ContractKind[]).map((k) => <option key={k} value={k}>{CONTRACT_KIND_LABEL[k]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="c-file">أو ارفع ملفاً نصياً</label>
            <input id="c-file" type="file" accept=".txt,.md,text/plain" onChange={(e) => loadFile(e.target.files?.[0])} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="c-text">نص الوثيقة</label>
          <textarea id="c-text" rows={12} value={text} placeholder="الصق نص العقد هنا…"
                    onChange={(e) => { setText(e.target.value); setSample(""); setRes(null); }} />
        </div>
        {msg && <p className="error" role="alert">{msg}</p>}
        <div className="row-actions">
          <button className="btn btn-action" type="button" disabled={text.trim().length < 40} onClick={run}>افحص الوثيقة</button>
          <span className="muted small">{text.trim().length.toLocaleString("en")} حرفاً</span>
        </div>
      </section>

      {res && counts && (
        <section className="check-panel" aria-live="polite">
          <div className="check-summary" data-tone={TONE[res.verdict]}>
            <div className="check-score"><b>{res.percentage}</b><span>%</span><small>نسبة الامتثال</small></div>
            <div>
              <h2>{CONTRACT_VERDICT_LABEL[res.verdict]} — {CONTRACT_KIND_LABEL[res.kind]}</h2>
              <p className="muted">{res.findings.length ? "راجع البنود أدناه بالترتيب: المخالفات أولاً ثم التنبيهات." : "لم يُعثر على مخالفات في البنود التي يغطيها الفاحص."}</p>
              <dl className="check-counts">
                <div><dt>مخالفات</dt><dd data-s={counts.v ? "FAIL" : "PASS"}>{counts.v}</dd></div>
                <div><dt>تنبيهات</dt><dd>{counts.w}</dd></div>
                <div><dt>بنود سليمة</dt><dd data-s="PASS">{res.passed.length}</dd></div>
              </dl>
            </div>
          </div>

          {res.findings.length > 0 && (
            <div className="results">
              <h3>الملاحظات</h3>
              <ul>
                {res.findings.map((f) => (
                  <li key={f.id} data-s="FAIL" data-sev={f.severity === "VIOLATION" ? "high" : "medium"}>
                    <div className="finding-head">
                      <span className="tag finding-sev" data-tone={f.severity === "VIOLATION" ? "bad" : "warn"}>{f.severity === "VIOLATION" ? "مخالفة" : "تنبيه"}</span>
                      <strong>{f.title}</strong>
                      {f.law && <span className="muted small">{f.law}</span>}
                    </div>
                    {f.excerpt && <blockquote className="finding-quote">{f.excerpt}</blockquote>}
                    <p className="res-msg">{f.explanation}</p>
                    {f.suggestion && (
                      <details>
                        <summary>الصياغة البديلة المقترحة</summary>
                        <p className="finding-fix">{f.suggestion}</p>
                        <button className="link-btn" type="button" onClick={() => navigator.clipboard?.writeText(f.suggestion!)}>نسخ الصياغة</button>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {res.passed.length > 0 && (
            <div className="results">
              <h3>بنود اجتازت الفحص</h3>
              <ul>{res.passed.map((p) => <li key={p} data-s="PASS">{p}</li>)}</ul>
            </div>
          )}

          <div className="results">
            <h3>حماية البيانات الشخصية في الوثيقة</h3>
            <p className="small">
              {pii.length ? <>حُجبت قبل الفحص: {pii.map(([k, n]) => `${n} ${PII_LABEL[k] ?? k}`).join("، ")}. هذا النص المحجوب هو ما سيُرسل لنموذج الذكاء الاصطناعي في المرحلة الثانية، لا النص الأصلي.</>
                : "لم يُعثر على أرقام هويات أو جوالات أو آيبان أو بريد إلكتروني."}
              {" "}<button className="link-btn" type="button" onClick={() => setShowRedacted((x) => !x)}>{showRedacted ? "إخفاء النص المحجوب" : "عرض النص المحجوب"}</button>
            </p>
            {showRedacted && <pre className="redacted-text">{res.redaction.text}</pre>}
          </div>

          <p className="disclaimer small muted">تحليل استرشادي آلي لا يُغني عن الاستشارة القانونية المرخّصة، وأرقام المواد للمراجعة القانونية.
            للمراجعة المتخصصة اطلب <Link href="/legal">استشارة محامٍ مرخّص</Link>.</p>
        </section>
      )}
    </>
  );
}
