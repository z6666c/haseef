export function Mark({ size = 32, title = "حَصيف" }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={(size * 72) / 64} viewBox="0 0 64 72" role="img" aria-label={title}>
      <path className="mark-shield" d="M32 3 L58 11.5 V33 C58 50.5 47 62.5 32 69 C17 62.5 6 50.5 6 33 V11.5 Z" fill="var(--ink)" />
      <path
        className="mark-ha"
        d="M46.5 19.5 C44.2 21.8 41.6 23 38.2 23 H22.5 L33.6 30.4 C24.2 33.8 18.6 39.8 19.4 46.4 C20.2 52.6 25.8 55.8 33 55.8 C36.4 55.8 39.4 55 41.6 53.6"
        fill="none" stroke="var(--paper)" strokeWidth={4.8} strokeLinecap="round" strokeLinejoin="round"
      />
      <circle cx={45.6} cy={50.4} r={4.4} fill="var(--emerald)" />
    </svg>
  );
}
