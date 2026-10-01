"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LIBRARY_CATEGORY_LABEL, LIBRARY_KIND_LABEL, REVIEW_BADGE, renderMarkdown, type LibraryDoc } from "@haseef/shared";
import { api } from "@/lib/session";

export default function LibraryDocPage() {
  const router = useRouter();
  const [doc, setDoc] = useState<(LibraryDoc & { body_md: string | null }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) { setError("المستند غير محدد"); return; }
    api.libraryDoc(id).then(setDoc).catch((e: Error) => setError(e.message));
  }, []);

  async function adopt() {
    if (!doc) return;
    setBusy(true); setError(null);
    try { const r = await api.adopt(doc.id); router.push(`/policies/view?id=${r.policy_id}`); }
    catch (e) { setError(e instanceof Error ? e.message : "تعذّر إنشاء السياسة"); setBusy(false); }
  }

  if (!doc) return error ? <p className="error" role="alert">{error}</p> : <div className="boot" aria-busy="true" />;
  return (
    <>
      <p className="crumbs"><Link href="/library">المكتبة المرجعية</Link> / {doc.title}</p>
      <header className="page-head page-head-row">
        <div>
          <div className="res-head">
            <span className="tag">{LIBRARY_KIND_LABEL[doc.kind]}</span>
            <span className="tag tag-quiet">{LIBRARY_CATEGORY_LABEL[doc.category] ?? doc.category}</span>
            {doc.review_status === "DRAFT" && <span className="draft-badge">{REVIEW_BADGE}</span>}
          </div>
          <h1>{doc.title}</h1>
          {doc.summary && <p className="muted">{doc.summary}</p>}
        </div>
        {doc.kind === "TEMPLATE" && doc.policy_type && (
          <button className="btn btn-action" type="button" disabled={busy} onClick={adopt}>استخدمه لمنشأتي</button>
        )}
      </header>
      {error && <p className="error" role="alert">{error}</p>}
      {doc.kind === "TEMPLATE" && (
        <p className="hint-box">«استخدمه لمنشأتي» ينشئ نسخة في سياساتك باسم منشأتك كمسودة، تعدّلها ثم يعتمدها مدير المنشأة.</p>
      )}
      <article className="panel md" dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.body_md ?? "") }} />
    </>
  );
}
