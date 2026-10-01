import { Mark } from "./Mark";

/**
 * الشعار الكامل (دليل الهوية §1): الرمز + «حَصيف» + HASEEF بتباعد 0.15em
 * + سطر التعريف Governance, Risk & Compliance (GRC).
 * variant="compact" للشريط الجانبي: الرمز + «حَصيف» فقط.
 */
export function Logo({ variant = "full", tone = "dark" }: { variant?: "full" | "compact"; tone?: "dark" | "light" }) {
  return (
    <span className="logo" data-variant={variant} data-tone={tone}>
      <Mark size={variant === "full" ? 52 : 28} />
      <span className="logo-type">
        <span className="logo-ar">حَصيف</span>
        {variant === "full" && (
          <>
            <span className="logo-en" lang="en" dir="ltr">HASEEF</span>
            <span className="logo-sub" lang="en" dir="ltr">Governance, Risk &amp; Compliance (GRC)</span>
          </>
        )}
      </span>
    </span>
  );
}
