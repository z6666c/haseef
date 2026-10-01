"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  LEGAL_TYPE_LABEL, LIBRARY_CATEGORY_LABEL, LIBRARY_KIND_LABEL, POLICY_TYPE_LABEL, REVIEW_BADGE, fileSize,
  type LibraryDoc,
} from "@haseef/shared";
import { External } from "@/components/Icons";
import { api } from "@/lib/session";

export default function LibraryPage() {
  const router = useRouter();
  const [docs, setDocs] = useState<LibraryDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cat, setCat] = useState<string>("ALL");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  useEffect(() => {
    api.library().then(setDocs).catch((e: Error) => setError(e.message));
    setTypeFilter(new URLSearchParams(window.location.search).get("type"));
  }, []);

  const cats = useMemo(() => Array.from(new Set((docs ?? []).map((d) => d.category))), [docs]);
  const shown = (docs ?? []).filter((d) =>
    (cat === "ALL" || d.category === cat) &&
    (!typeFilter || d.policy_type === typeFilter) &&
    (!q.trim() || `${d.title} ${d.summary ?? ""}`.includes(q.trim())));

  async function download(d: LibraryDoc) {
    setBusy(d.id); setError(null);
    try {
      const blob = await api.libraryFile(d.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = d.file_name ?? "ملف"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { setError(e instanceof Error ? e.message : "تعذّر التنزيل"); }
    finally { setBusy(null); }
  }

  async function adopt(d: LibraryDoc) {
    setBusy(d.id); setError(null);
    try {
      const r = await api.adopt(d.id);
      router.push(`/policies/view?id=${r.policy_id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "تعذّر إنشاء السياسة"); setBusy(null); }
  }

  if (!docs) return error ? <p className="error" role="alert">{error}</p> : <div className="boot" aria-busy="true" />;

  return (
    <>
      <header className="page-head">
        <h1>المكتبة المرجعية</h1>
        <p className="muted">نماذج سياسات جاهزة للتكييف، وأدلة عملية، وروابط الأنظمة والجهات الرسمية. المحتوى الموسوم «{REVIEW_BADGE}» لم يكتمل اعتماده القانوني بعد.</p>
      </header>

      <div className="lib-tools">
        <div className="filters" role="group" aria-label="التصنيف">
          <button type="button" aria-pressed={cat === "ALL"} onClick={() => setCat("ALL")}>الكل</button>
          {cats.map((c) => <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(c)}>{LIBRARY_CATEGORY_LABEL[c] ?? c}</button>)}
        </div>
        <input className="search" type="search" placeholder="ابحث في المكتبة" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" />
      </div>
      {typeFilter && (
        <p className="hint-box">تعرض نماذج: {POLICY_TYPE_LABEL[typeFilter] ?? typeFilter}.{" "}
          <button className="link-btn" type="button" onClick={() => setTypeFilter(null)}>عرض الكل</button></p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {shown.length === 0 && <p className="empty">لا نتائج.</p>}

      <ul className="lib-grid">
        {shown.map((d) => (
          <li key={d.id} className="lib-card" data-kind={d.kind}>
            <div className="res-head">
              <span className="tag">{LIBRARY_KIND_LABEL[d.kind]}</span>
              <span className="tag tag-quiet">{LIBRARY_CATEGORY_LABEL[d.category] ?? d.category}</span>
              {d.review_status === "DRAFT" && <span className="draft-badge">{REVIEW_BADGE}</span>}
            </div>
            <h3>{d.title}</h3>
            {d.summary && <p className="muted small">{d.summary}</p>}
            {d.applies_legal_types.length > 0 && (
              <p className="small muted">يناسب: {d.applies_legal_types.map((t) => LEGAL_TYPE_LABEL[t] ?? t).join("، ")}</p>
            )}
            <div className="lib-actions">
              {(d.kind === "TEMPLATE" || d.kind === "GUIDE") && <Link className="btn btn-quiet" href={`/library/view?id=${d.id}`}>اقرأ</Link>}
              {d.kind === "TEMPLATE" && d.policy_type && (
                d.adopted ? <span className="small tracked">أُضيف إلى سياساتك</span>
                  : <button className="btn btn-action" type="button" disabled={busy === d.id} onClick={() => adopt(d)}>استخدمه لمنشأتي</button>
              )}
              {d.kind === "LAW" && d.url && (
                <a className="btn btn-quiet" href={d.url} target="_blank" rel="noopener noreferrer">افتح المصدر الرسمي <External size={14} /></a>
              )}
              {d.kind === "FILE" && (
                <button className="btn btn-quiet" type="button" disabled={busy === d.id} onClick={() => download(d)}>
                  تنزيل {d.file_size ? `(${fileSize(d.file_size)})` : ""}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
