"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { POLICY_STATUS_LABEL, POLICY_TYPE_LABEL, renderMarkdown, type Policy } from "@haseef/shared";
import { api } from "@/lib/session";

type Full = Policy & { body_md: string | null; source_library_id: string | null };

export default function PolicyPage() {
  const [p, setP] = useState<Full | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState({ title: "", body_md: "", version: "1.0" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback((pid: string) => {
    api.policy(pid).then((r) => { setP(r); setDraft({ title: r.title, body_md: r.body_md ?? "", version: r.version }); })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    const pid = new URLSearchParams(window.location.search).get("id");
    setId(pid);
    if (pid) load(pid); else setError("السياسة غير محددة");
  }, [load]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    if (!id) return;
    setBusy(true); setError(null); setNotice(null);
    try { await fn(); setNotice(ok); setEdit(false); load(id); }
    catch (e) { setError(e instanceof Error ? e.message : "تعذّر الحفظ"); }
    finally { setBusy(false); }
  }

  if (!p) return error ? <p className="error" role="alert">{error}</p> : <div className="boot" aria-busy="true" />;
  const unresolved = (p.body_md ?? "").match(/«[^»]+»/g)?.length ?? 0;

  return (
    <>
      <p className="crumbs"><Link href="/policies">السياسات الداخلية</Link> / {p.title}</p>
      <header className="page-head page-head-row">
        <div>
          <h1>{p.title}</h1>
          <p className="muted">{POLICY_TYPE_LABEL[p.policy_type] ?? p.policy_type} · إصدار {p.version} ·{" "}
            <span className="status-chip" data-s={p.effective_status}>{POLICY_STATUS_LABEL[p.effective_status] ?? p.effective_status}</span></p>
        </div>
        <div className="head-actions">
          {!edit && <button className="btn btn-quiet" type="button" onClick={() => setEdit(true)}>تعديل النص</button>}
          {p.status !== "ACTIVE" && (
            <button className="btn btn-action" type="button" disabled={busy || unresolved > 0}
                    title={unresolved ? "أكمل الحقول المظللة أولاً" : undefined}
                    onClick={() => run(() => api.approvePolicy(p.id), "اعتُمدت السياسة. موعد مراجعتها بعد سنة.")}>اعتماد السياسة</button>
          )}
        </div>
      </header>
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {unresolved > 0 && !edit && (
        <p className="hint-box">في النص {unresolved} {unresolved === 1 ? "حقل" : unresolved <= 10 ? "حقول" : "حقلاً"} بين «» تحتاج تعبئة ببيانات منشأتك قبل الاعتماد. الاعتماد لمدير المنشأة.</p>
      )}

      {edit ? (
        <form className="panel inline-form" onSubmit={(e) => { e.preventDefault(); run(() => api.updatePolicy(p.id, { ...draft, body_md: draft.body_md || null }), "حُفظ النص"); }}>
          <div className="grid">
            <div className="field"><label htmlFor="t">العنوان</label>
              <input id="t" required minLength={2} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></div>
            <div className="field"><label htmlFor="v">الإصدار</label>
              <input id="v" value={draft.version} onChange={(e) => setDraft({ ...draft, version: e.target.value })} /></div>
          </div>
          <div className="field"><label htmlFor="b">النص (يدعم العناوين # والقوائم - والجداول |)</label>
            <textarea id="b" className="md-editor" rows={24} value={draft.body_md} onChange={(e) => setDraft({ ...draft, body_md: e.target.value })} /></div>
          <div className="actions">
            <button className="btn btn-action" type="submit" disabled={busy}>حفظ</button>
            <button className="btn btn-quiet" type="button" onClick={() => setEdit(false)}>إلغاء</button>
          </div>
        </form>
      ) : p.body_md ? (
        <article className="panel md" dangerouslySetInnerHTML={{ __html: renderMarkdown(p.body_md) }} />
      ) : (
        <p className="empty">لا يوجد نص محفوظ لهذه السياسة في حصيف.</p>
      )}
    </>
  );
}
