import Link from "next/link";
import { PLATFORM_LEGAL, PLATFORM_LEGAL_PAGES, PLATFORM_LEGAL_STATUS, renderMarkdown, type PlatformLegalKey } from "@haseef/shared";
import { Logo } from "./Logo";

/** صفحة قانونية عامة (بلا دخول): الشعار، العنوان، تاريخ التحديث، النص، وروابط بقية الوثائق. */
export function LegalDoc({ id }: { id: PlatformLegalKey }) {
  const doc = PLATFORM_LEGAL[id];
  return (
    <div className="legal-page">
      <header className="legal-top">
        <Link href="/login" aria-label="حَصيف — الدخول"><Logo variant="compact" /></Link>
        <nav aria-label="الوثائق القانونية" className="legal-nav">
          {PLATFORM_LEGAL_PAGES.map((p) => (
            <Link key={p.key} href={p.href} aria-current={p.key === id ? "page" : undefined}>{p.short}</Link>
          ))}
        </nav>
      </header>
      <main className="legal-main">
        <p className="legal-draft" role="note">{PLATFORM_LEGAL_STATUS}</p>
        <h1>{doc.title}</h1>
        <p className="muted small">آخر تحديث: {doc.updated}</p>
        <article className="panel md" dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.body) }} />
      </main>
      <LegalFooter />
    </div>
  );
}

export function LegalFooter({ withLogin = true }: { withLogin?: boolean }) {
  return (
    <footer className="legal-foot">
      {PLATFORM_LEGAL_PAGES.map((p) => <Link key={p.key} href={p.href}>{p.short}</Link>)}
      {withLogin && <Link href="/login">الدخول إلى المنصة</Link>}
      <span className="muted">© {new Date().getFullYear()} حَصيف</span>
    </footer>
  );
}
