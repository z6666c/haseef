import { PILLAR_LABEL, type Pillar, type Score } from "@haseef/shared";

const SHIELD = "M32 3 L58 11.5 V33 C58 50.5 47 62.5 32 69 C17 62.5 6 50.5 6 33 V11.5 Z";

function tone(score: number): "good" | "warn" | "bad" {
  if (score >= 80) return "good";
  if (score >= 50) return "warn";
  return "bad";
}

/**
 * ختم حصافة: الدرع نفسه من الشعار يمتلئ من الأسفل بنسبة المؤشر.
 * هو العنصر البصري الوحيد "الجريء" في الواجهة؛ كل ما حوله هادئ.
 */
export function ScoreSeal({ score }: { score: Score }) {
  const value = score.score;
  const level = value === null ? 0 : value;
  // ارتفاع منطقة الدرع داخل viewBox من y=3 إلى y=69
  const fillTop = 69 - (66 * level) / 100;
  const t = value === null ? "none" : tone(value);
  const pillars = Object.entries(score.pillars) as [Pillar, number | null][];

  return (
    <section className="seal" aria-labelledby="seal-title">
      <div className="seal-figure" data-tone={t} data-over={level >= 58}>
        <svg viewBox="0 0 64 72" aria-hidden="true">
          <defs>
            <clipPath id="seal-clip"><path d={SHIELD} /></clipPath>
            <pattern id="seal-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="4" stroke="var(--line)" strokeWidth="1.5" />
            </pattern>
          </defs>
          <path d={SHIELD} fill={value === null ? "url(#seal-hatch)" : "var(--surface)"} stroke="var(--ink)" strokeWidth="1.6" />
          {value !== null && (
            <g clipPath="url(#seal-clip)">
              <rect className="seal-level" x="0" y={fillTop} width="64" height={72 - fillTop} />
            </g>
          )}
        </svg>
        <div className="seal-value">
          {value === null ? (
            <span className="seal-unrated">غير مُقيَّم</span>
          ) : (
            <>
              <span className="seal-number">{value}</span>
              <span className="seal-pct">%</span>
            </>
          )}
        </div>
      </div>

      <div className="seal-detail">
        <h2 id="seal-title">مؤشر حصافة</h2>
        {value === null ? (
          <p className="muted">أضف تراخيص منشأتك وسياساتها ليظهر المؤشر.</p>
        ) : (
          <dl className="pillars">
            {pillars.map(([key, v]) => (
              <div key={key} className="pillar" data-off={v === null}>
                <dt>{PILLAR_LABEL[key]}</dt>
                <dd>
                  {v === null ? (
                    <span className="muted">لا بيانات بعد</span>
                  ) : (
                    <>
                      <meter min={0} max={100} value={v} aria-label={PILLAR_LABEL[key]} />
                      <span className="pillar-num" dir="ltr">{Math.round(v)}%</span>
                      <span className="pillar-weight">وزنه <span dir="ltr">{Math.round(score.weights_used[key] ?? 0)}%</span></span>
                    </>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {score.capped_by_critical_expiry && (
          <p className="seal-cap">المؤشر محدود عند 50% لوجود ترخيص حرج منتهٍ. جدّده ليُحتسب مؤشرك كاملاً.</p>
        )}
      </div>
    </section>
  );
}
