"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatDate, sar, type BotOverview } from "@haseef/shared";
import { api } from "@/lib/session";

type Tab = "chat" | "members" | "knowledge" | "acks" | "settings";
const STATUS: Record<string, [string, string]> = { ACTIVE: ["IN_PLACE", "فعّال"], INVITED: ["PENDING", "بانتظار موافقته"], PENDING: ["PENDING", "طلب انضمام"] };
const INTENT: Record<string, string> = { ANSWER: "أُجيب", NO_ANSWER: "بلا إجابة", SENSITIVE: "سؤال حساس — رُفض", ACK: "إقرار", MENU: "قائمة", POLICIES: "قائمة السياسات",
  POLICY: "ملخص سياسة", CONSENT: "موافقة", OPT_OUT: "إيقاف", QUOTA: "بلغ الحد", JOIN: "طلب انضمام" };
const fmtTime = (d: string) => new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" }).format(new Date(d));

export default function BotPage() {
  const [ov, setOv] = useState<BotOverview | null>(null);
  const [tab, setTab] = useState<Tab>("chat");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { api.botOverview().then(setOv).catch((e: Error) => setError(e.message)); }, []);
  useEffect(load, [load]);
  async function act(fn: () => Promise<unknown>, ok: string) {
    setError(null); setNotice(null);
    try { await fn(); setNotice(ok); load(); return true; } catch (e) { setError(e instanceof Error ? e.message : "تعذّر"); return false; }
  }
  if (!ov) return error ? <p className="error">{error}</p> : <div className="boot" aria-busy="true" />;

  if (!ov.access.via) {
    return (
      <>
        <header className="page-head"><h1>بوت الموظفين على واتساب</h1></header>
        <section className="panel inline-form" style={{ maxWidth: 680 }}>
          <p>مساعد على واتساب يجيب موظفيك عن سياسات المنشأة وإجراءاتها (الإجازات، الدوام، الحضور، بدل السفر…) من المحتوى الذي تختار مشاركته فقط،
            ويستقبل إقرارهم بالاطلاع على السياسات، ويرفض أسئلة الرواتب والبيانات الشخصية ويحيلها للموارد البشرية.</p>
          <ul className="labor-rules">
            <li>بلا تطبيق ولا كلمة مرور للموظف: يكفي رقم جواله.</li>
            <li>كل إجابة تذكر مصدرها من سياساتك، وما لا يجد له إجابة يُحال إليك.</li>
            <li>سجل كامل للأسئلة والإقرارات، وإيقاف تلقائي عند انتهاء خدمة الموظف.</li>
          </ul>
          <p className="price"><b>{ov.access.price != null ? sar(ov.access.price) : "—"}</b> <span className="muted small">شهرياً قبل الضريبة لباقتك الحالية</span></p>
          {ov.can_manage ? <Link className="btn btn-action" href="/billing">اشترك في البوت</Link> : <p className="hint-box">يفعّله مدير المنشأة من «الاشتراك والدفعات».</p>}
        </section>
      </>
    );
  }

  const st = ov.stats!;
  return (
    <>
      <header className="page-head">
        <h1>بوت الموظفين على واتساب</h1>
        <p className="muted">يجيب موظفيك من السياسات المعلَّمة «للموظفين» والأسئلة الشائعة فقط، ويسجّل إقرارهم بالاطلاع.
          {ov.access.via === "PLAN" ? " مشمول في باقتك." : ov.access.paid_until ? ` اشتراكك ساري حتى ${formatDate(ov.access.paid_until.slice(0, 10))}.` : ""}</p>
      </header>
      {!ov.live && <p className="hint-box">الرسائل الفعلية تبدأ بعد ربط رقم حصيف للأعمال لدى Meta. جرّب المحادثة الآن من تبويب «تجربة المحادثة».</p>}
      <dl className="obl-stats labor-stats">
        <div><dt>موظفون فعّالون</dt><dd data-s="IN_PLACE">{st.members_active}{ov.access.limits.members ? <small className="muted"> / {ov.access.limits.members}</small> : null}</dd></div>
        <div><dt>أسئلة هذا الشهر</dt><dd>{st.questions_month}{ov.access.limits.questions ? <small className="muted"> / {ov.access.limits.questions}</small> : null}</dd></div>
        <div><dt>سياسات مشاركة</dt><dd data-s={st.shared_policies ? undefined : "PENDING"}>{st.shared_policies}</dd></div>
        <div><dt>أسئلة بلا إجابة</dt><dd data-s={ov.unanswered?.length ? "PENDING" : undefined}>{ov.unanswered?.length ?? 0}</dd></div>
      </dl>
      <div className="tabs-row">
        <div className="filters" role="tablist">
          {([["chat", "تجربة المحادثة"], ["members", "الموظفون"], ["knowledge", "المعرفة"], ["acks", "الإقرارات"], ["settings", "الإعدادات"]] as [Tab, string][]).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>))}
        </div>
      </div>
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {tab === "chat" && <ChatTab ov={ov} onDone={load} />}
      {tab === "members" && <MembersTab ov={ov} act={act} />}
      {tab === "knowledge" && <KnowledgeTab ov={ov} act={act} />}
      {tab === "acks" && <AcksTab />}
      {tab === "settings" && <SettingsTab ov={ov} act={act} />}
    </>
  );
}

type Act = (fn: () => Promise<unknown>, ok: string) => Promise<boolean>;

function ChatTab({ ov, onDone }: { ov: BotOverview; onDone: () => void }) {
  const [member, setMember] = useState<string>("");
  const [text, setText] = useState("");
  const [chat, setChat] = useState<{ dir: "in" | "out"; body: string; meta?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [chat]);
  async function send(q: string) {
    if (!q.trim()) return;
    setBusy(true); setChat((c) => [...c, { dir: "in", body: q }]); setText("");
    try {
      const r = await api.botSimulate(q, member || null);
      setChat((c) => [...c, { dir: "out", body: r.reply, meta: INTENT[r.intent] ?? r.intent }]);
      onDone();
    } catch (e) { setChat((c) => [...c, { dir: "out", body: e instanceof Error ? e.message : "تعذّر" }]); }
    finally { setBusy(false); }
  }
  const samples = ["مساعدة", "السياسات", "كم مدة الإجازة السنوية؟", "ما ساعات الدوام؟", "كم راتب زميلي؟", "أقر 1"];
  return (
    <section className="gov-section" style={{ marginTop: 8 }}>
      <div className="grid" style={{ marginBottom: 8 }}>
        <div className="field"><label htmlFor="sm">جرّب بصفة</label>
          <select id="sm" value={member} onChange={(e) => { setMember(e.target.value); setChat([]); }}>
            <option value="">مدير (تجربة دون تسجيل إقرار)</option>
            {ov.members?.map((m) => <option key={m.id} value={m.id}>{m.full_name} — {STATUS[m.status]?.[1]}</option>)}
          </select></div>
      </div>
      <div className="chat" ref={box} aria-live="polite">
        {chat.length === 0 && <p className="small muted">اكتب سؤالاً كما يكتبه موظف على واتساب.</p>}
        {chat.map((m, i) => <div key={i} className={`msg ${m.dir === "in" ? "out" : "in"}`}>{m.body}{m.meta && <small>{m.meta}</small>}</div>)}
      </div>
      <div className="chip-row" style={{ marginTop: 8 }}>{samples.map((s) => <button key={s} type="button" className="chip" disabled={busy} onClick={() => send(s)}>{s}</button>)}</div>
      <form className="chat-form" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="اكتب رسالة…" maxLength={1000} />
        <button className="btn btn-action" type="submit" disabled={busy || !text.trim()}>إرسال</button>
      </form>
      {ov.unanswered && ov.unanswered.length > 0 && (
        <>
          <h2 style={{ marginTop: 20 }}>أسئلة لم يجد لها البوت إجابة</h2>
          <p className="small muted">أضف إجاباتها في «المعرفة» حتى يجيب عنها البوت مستقبلاً.</p>
          <ul className="labor-rules">{ov.unanswered.map((u, i) => <li key={i}>«{u.body}» — {u.full_name ?? "—"} · {fmtTime(u.created_at)}</li>)}</ul>
        </>
      )}
      <h2 style={{ marginTop: 20 }}>آخر المحادثات</h2>
      <table className="deadlines labor-table">
        <thead><tr><th>الرسالة</th><th>الموظف</th><th>الوقت</th></tr></thead>
        <tbody>{(ov.log ?? []).filter((x) => x.direction === "IN").slice(0, 15).map((x) => (
          <tr key={x.id}><td>{x.body}{x.simulated && <span className="tag tag-quiet">تجربة</span>}</td><td>{x.full_name ?? "مدير"}</td><td className="small">{fmtTime(x.created_at)}</td></tr>))}</tbody>
      </table>
    </section>
  );
}

function MembersTab({ ov, act }: { ov: BotOverview; act: Act }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("+9665");
  const s = ov.settings!;
  return (
    <section className="gov-section" style={{ marginTop: 8 }}>
      {ov.can_manage && (
        <form className="panel inline-form" onSubmit={async (e) => { e.preventDefault(); if (await act(() => api.botAddMember({ full_name: name, phone }), `أُرسلت الدعوة إلى ${name}`)) { setName(""); setPhone("+9665"); } }}>
          <h2>دعوة موظف</h2>
          <div className="grid">
            <div className="field"><label htmlFor="bn">الاسم</label><input id="bn" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="field"><label htmlFor="bp">الجوال</label><input id="bp" dir="ltr" required pattern="\+9665\d{8}" value={phone} onChange={(e) => setPhone(e.target.value.trim())} /></div>
          </div>
          <p className="small muted">تصله رسالة دعوة على واتساب، ولا يُفعَّل إلا بعد رده «موافق». أو شارك رمز الانضمام <span className="code-box">انضمام {s.invite_code}</span> ليرسله الموظف بنفسه{s.require_approval ? " وتوافق على طلبه" : ""}.</p>
          <div><button className="btn btn-action" type="submit">أرسل الدعوة</button></div>
        </form>
      )}
      <table className="deadlines labor-table">
        <thead><tr><th>الموظف</th><th>الحالة</th><th>الإقرارات</th><th /></tr></thead>
        <tbody>{(ov.members ?? []).map((m) => (
          <tr key={m.id}>
            <td><b>{m.full_name}</b><div className="small muted" dir="ltr" style={{ textAlign: "start" }}>{m.phone}</div></td>
            <td><span className="status-chip" data-s={STATUS[m.status]?.[0]}>{STATUS[m.status]?.[1] ?? m.status}</span><div className="small muted">{m.joined_via === "CODE" ? "انضم بالرمز" : "بدعوة"}</div></td>
            <td>{m.acks}</td>
            <td>{ov.can_manage && <div style={{ display: "flex", gap: 6 }}>
              {m.status === "PENDING" && <button className="btn btn-action btn-xs" type="button" onClick={() => act(() => api.botApprove(m.id), `فُعّل ${m.full_name}`)}>موافقة</button>}
              <button className="btn btn-quiet btn-xs" type="button" onClick={() => act(() => api.botRemove(m.id), `أُزيل ${m.full_name}`)}>إزالة</button></div>}</td>
          </tr>))}</tbody>
      </table>
    </section>
  );
}

function KnowledgeTab({ ov, act }: { ov: BotOverview; act: Act }) {
  const [q, setQ] = useState("");
  const [a, setA] = useState("");
  return (
    <section className="gov-section" style={{ marginTop: 8 }}>
      <h2>السياسات</h2>
      <p className="small muted">لا يعرف البوت إلا السياسات المعتمدة التي تعلّمها «للموظفين». ما لم يُشارك لا يمكن استخراجه بأي سؤال.</p>
      <table className="deadlines labor-table">
        <thead><tr><th>السياسة</th><th>متاحة للموظفين</th><th>إقرارات الإصدار الحالي</th></tr></thead>
        <tbody>{(ov.policies ?? []).map((p) => (
          <tr key={p.id}><td><b>{p.title}</b><div className="small muted">إصدار {p.version}</div></td>
            <td><label className="checks-inline"><input type="checkbox" disabled={!ov.can_manage} checked={p.shared_with_employees}
              onChange={(e) => act(() => api.botSharePolicy(p.id, { shared: e.target.checked, employee_summary: p.employee_summary }), e.target.checked ? `«${p.title}» متاحة للموظفين` : `أُخفيت «${p.title}» عن البوت`)} /> {p.shared_with_employees ? "نعم" : "لا"}</label></td>
            <td>{p.acks}</td></tr>))}
          {(ov.policies ?? []).length === 0 && <tr><td colSpan={3} className="muted">لا سياسات معتمدة بعد. <Link href="/policies">أضف من «السياسات الداخلية»</Link>.</td></tr>}
        </tbody>
      </table>
      <h2 style={{ marginTop: 20 }}>الأسئلة الشائعة</h2>
      {ov.can_manage && (
        <form className="panel inline-form" onSubmit={async (e) => { e.preventDefault(); if (await act(() => api.botAddFaq({ question: q, answer: a }), "أُضيف السؤال")) { setQ(""); setA(""); } }}>
          <div className="grid">
            <div className="field field-wide"><label htmlFor="fq">السؤال</label><input id="fq" required minLength={3} maxLength={300} value={q} onChange={(e) => setQ(e.target.value)} placeholder="مثال: متى تُصرف الرواتب؟" /></div>
            <div className="field field-wide"><label htmlFor="fa">الإجابة</label><textarea id="fa" rows={2} required maxLength={2000} value={a} onChange={(e) => setA(e.target.value)} /></div>
          </div>
          <div><button className="btn btn-action" type="submit">إضافة</button></div>
        </form>
      )}
      <ul className="ropa-list">{(ov.faqs ?? []).map((f) => (
        <li key={f.id}><div className="res-head"><strong>{f.question}</strong>{!f.is_active && <span className="tag tag-quiet">موقوف</span>}</div><p>{f.answer}</p>
          {ov.can_manage && <button className="link-btn" type="button" onClick={() => act(() => api.botDeleteFaq(f.id), "حُذف السؤال")}>حذف</button>}</li>))}</ul>
    </section>
  );
}

function AcksTab() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.botAcks>> | null>(null);
  useEffect(() => { api.botAcks().then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return <div className="boot" aria-busy="true" />;
  const byPolicy = new Map<string, typeof rows>();
  rows.forEach((r) => byPolicy.set(r.policy_id, [...(byPolicy.get(r.policy_id) ?? []), r]));
  return (
    <section className="gov-section" style={{ marginTop: 8 }}>
      {byPolicy.size === 0 && <p className="empty">لا سياسات مشاركة أو لا موظفين فعّالين بعد.</p>}
      {[...byPolicy.values()].map((list) => {
        const done = list.filter((r) => r.acknowledged_at).length;
        return (
          <div key={list[0].policy_id} className="labor-month">
            <h2>{list[0].title} <small className="muted">إصدار {list[0].version} · {done} من {list.length}</small></h2>
            <table className="deadlines labor-table"><thead><tr><th>الموظف</th><th>الإقرار</th></tr></thead>
              <tbody>{list.map((r) => <tr key={r.member_id}><td>{r.full_name}</td><td>{r.acknowledged_at
                ? <span className="status-chip" data-s="IN_PLACE">أقرّ {fmtTime(r.acknowledged_at)}</span> : <span className="status-chip" data-s="PENDING">لم يقرّ</span>}</td></tr>)}</tbody></table>
          </div>
        );
      })}
    </section>
  );
}

function SettingsTab({ ov, act }: { ov: BotOverview; act: Act }) {
  const s = ov.settings!;
  const [v, setV] = useState({ enabled: s.enabled, welcome_text: s.welcome_text ?? "", hr_contact: s.hr_contact ?? "", require_approval: s.require_approval });
  return (
    <form className="panel inline-form" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); act(() => api.botSettings({ ...v, welcome_text: v.welcome_text || null, hr_contact: v.hr_contact || null }), "حُفظت الإعدادات"); }}>
      <label className="checks-inline"><input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} disabled={!ov.can_manage} /> البوت يعمل</label>
      <label className="checks-inline"><input type="checkbox" checked={v.require_approval} onChange={(e) => setV({ ...v, require_approval: e.target.checked })} disabled={!ov.can_manage} /> طلبات الانضمام بالرمز تحتاج موافقتي</label>
      <div className="field"><label htmlFor="hr">جهة الموارد البشرية (تظهر عند الإحالة)</label><input id="hr" maxLength={150} value={v.hr_contact} onChange={(e) => setV({ ...v, hr_contact: e.target.value })} disabled={!ov.can_manage} /></div>
      <div className="field"><label htmlFor="wt">رسالة الترحيب (اختياري)</label><textarea id="wt" rows={2} maxLength={500} value={v.welcome_text} onChange={(e) => setV({ ...v, welcome_text: e.target.value })} disabled={!ov.can_manage} /></div>
      <div className="field"><label>رمز الانضمام</label><div style={{ display: "flex", gap: 8, alignItems: "center" }}><span className="code-box">انضمام {s.invite_code}</span>
        {ov.can_manage && <button className="btn btn-quiet btn-xs" type="button" onClick={() => act(() => api.botRotateCode(), "أُنشئ رمز جديد وأُبطل السابق")}>رمز جديد</button>}</div></div>
      {ov.can_manage && <div><button className="btn btn-action" type="submit">حفظ</button></div>}
    </form>
  );
}
