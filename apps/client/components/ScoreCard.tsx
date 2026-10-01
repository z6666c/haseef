import { PILLAR_LABEL, scoreTone, type Pillar, type Score } from "@haseef/shared";
import { ShieldCheck } from "./Icons";

const R = 52;
const C = 2 * Math.PI * R;

const HEADLINE: Record<string, string> = {
  good: "منشأتك محصّنة ومكتملة الامتثال",
  warn: "يمكن رفع المؤشر بمعالجة ما يلي",
  bad: "منشأتك معرّضة لمخاطر نظامية عاجلة",
};

/** البطاقة القيادية (دليل الهوية §3.2): مقياس دائري من 100% + سبب الخصم. */
export function ScoreCard({ score }: { score: Score }) {
  const value = score.score;
  const tone = scoreTone(value);
  const dash = value === null ? 0 : (C * value) / 100;
  const pillars = (Object.entries(score.pillars) as [Pillar, number | null][]).filter(([, v]) => v !== null);
  const reasons = score.reasons.slice(0, 3);

  return (
    <section className="score-card haseef-card-glass" data-tone={tone} aria-labelledby="score-title">
      <div className="gauge">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r={R} className="gauge-track" />
          {value !== null && (
            <circle cx="60" cy="60" r={R} className="gauge-arc"
                    strokeDasharray={`${dash} ${C}`} style={{ ["--gauge-len" as string]: `${dash}` }} />
          )}
        </svg>
        <div className="gauge-value" dir="ltr">
          {value === null ? <span className="gauge-unrated">غير مُقيَّم</span> : <><b>{value}</b><span>%</span></>}
        </div>
      </div>

      <div className="score-body">
        <h2 id="score-title"><ShieldCheck size={22} /> مؤشر حَصيف</h2>
        {value === null ? (
          <p className="muted">أضف تراخيص منشأتك وسياساتها ليظهر المؤشر.</p>
        ) : (
          <>
            <p className="score-headline">{HEADLINE[tone]}</p>
            {reasons.length > 0 && (
              <ul className="reasons">
                {reasons.map((r) => (
                  <li key={r.text} data-sev={r.severity}>
                    <span>{r.text}</span>
                    {r.points_label && <span className="reason-pts">يخصم {r.points_label}</span>}
                  </li>
                ))}
              </ul>
            )}
            <dl className="pillars">
              {pillars.map(([key, v]) => (
                <div key={key}>
                  <dt>{PILLAR_LABEL[key]}</dt>
                  <dd><span dir="ltr">{Math.round(v as number)}%</span> <small>وزنه <span dir="ltr">{Math.round(score.weights_used[key] ?? 0)}%</span></small></dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
    </section>
  );
}
