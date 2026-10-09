/**
 * محرك بوت الموظفين — مطابق لـ apps/api/haseef/domain/bot.py (نفس الحالات في bot.test.ts و test_growth.py).
 * يجيب فقط من السياسات المعلَّمة «للموظفين» والأسئلة الشائعة، ويرفض أسئلة الرواتب والبيانات الشخصية والمالية.
 */
const DIAC = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const STOP_RAW: string[] = (["في", "من", "على", "عن", "الى", "إلى", "ما", "ماذا", "هل", "كيف", "متى", "لماذا", "اين", "أين", "هو", "هي", "هم", "ان", "أن", "او", "أو", "و", "يا", "لي", "لنا", "عند", "مع", "هذا", "هذه", "ذلك", "تلك", "التي", "الذي", "كم", "اي", "أي", "ممكن", "ابي", "ابغى", "اريد", "أريد", "ودي", "لو", "بعد", "قبل", "كل", "بين", "حول", "الشركه", "الشركة", "المنشاه", "المنشأة", "عندنا", "عندكم", "لدينا", "وش", "ايش", "شو", "موظف", "الموظف", "الموظفين", "موظفين", "يبدا", "يبدأ", "ينتهي", "يكون", "يصير"]);
const SENSITIVE = /(راتب|رواتب|مرتب|اجور|ايبان|حساب بنكي|رقم الهويه|هويه|جواز|ارباح|ميزانيه|مبيعات|ايرادات|عقد (موظف|زميل)|بيانات (موظف|زميل)|كلمه المرور|باسورد)/;
const SYN: Record<string, string> = { دوام: "عمل", شغل: "عمل", اوقات: "ساعات", اجازت: "اجازه", عطله: "اجازه", عطل: "اجازه",
  تاخر: "تاخير", غياب: "غياب", انصراف: "انصراف", بدل: "بدل", سفر: "سفر", انتداب: "سفر" };
const MIN_SCORE = 1.2;
const MAX_ANSWER = 700;
export const BOT_MENU = "اكتب سؤالك مباشرة، مثل: كم أيام الإجازة السنوية؟\nأو استخدم الأوامر:\n• «السياسات» لقائمة السياسات\n• «سياسة 2» لملخص سياسة\n• «أقر 2» للإقرار بالاطلاع عليها\n• «إيقاف» لإلغاء الاشتراك";

export function botNorm(s: string): string {
  s = s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));
  s = s.replace(DIAC, "").toLowerCase().replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي");
  return s.replace(/[^\p{L}\p{N}_\s]/gu, " ").replace(/\s+/g, " ").trim();
}
const STOP = new Set(STOP_RAW.map((w) => botNorm(w)));
function stem(w: string): string {
  let done = false;
  for (const p of ["وال", "بال", "كال", "فال", "لل", "ال"]) {
    if (w.startsWith(p) && [...w].length - [...p].length >= 3) { w = w.slice(p.length); done = true; break; }
  }
  if (!done && ["ب", "و", "ف", "ك", "ل"].includes(w[0] ?? "") && [...w].length >= 5) w = w.slice(1);
  for (const suf of ["ات", "ون", "ين", "ها", "هم"]) {
    if (w.endsWith(suf) && [...w].length - [...suf].length >= 3) { w = w.slice(0, -suf.length); break; }
  }
  return w;
}
export function botTokens(s: string): string[] {
  const out: string[] = [];
  for (const raw of botNorm(s).split(" ")) {
    if (!raw || STOP.has(raw) || [...raw].length < 2) continue;
    const w = stem(raw);
    out.push(SYN[w] ?? w);
  }
  return out;
}

export interface BotPolicy { id: string; title: string; version: string; body: string; summary?: string | null }
export interface BotState {
  member_status: "INVITED" | "PENDING" | "ACTIVE" | "REMOVED" | null; member_name?: string; org_name?: string;
  hr_contact?: string | null; welcome?: string | null; policies?: BotPolicy[]; faqs?: [string, string, string][];
  acknowledged?: Set<string>; quota_left?: number | null;
}
export interface BotReply { text: string; intent: string; sources: { kind: string; id: string; title: string; score?: number }[]; action: Record<string, unknown> | null }
interface Doc { id: string; kind: "FAQ" | "POLICY"; title: string; text: string; ref: string }

function chunks(policies: BotPolicy[], faqs: [string, string, string][]): Doc[] {
  const out: Doc[] = faqs.map(([i, q, a]) => ({ id: `faq:${i}`, kind: "FAQ", title: q, text: `${q}\n${a}`, ref: "سؤال شائع" }));
  policies.forEach((p, n) => {
    const parts = (p.body || "").split(/\n(?=#+ )|\n\s*\n/).map((x) => x.trim()).filter(Boolean);
    parts.forEach((part, k) => {
      const head = part.match(/^#+\s*(.+)/);
      out.push({ id: `pol:${p.id}:${k}`, kind: "POLICY", title: p.title, text: part.replace(/^#+\s*/gm, ""),
        ref: `سياسة ${n + 1}` + (head ? ` — ${head[1].slice(0, 60)}` : "") });
    });
  });
  return out;
}

export function botRank(question: string, docs: Doc[]): [number, Doc][] {
  const q = [...new Set(botTokens(question))];
  if (!q.length || !docs.length) return [];
  const toks = docs.map((d) => botTokens(`${d.title} ${d.text}`));
  const n = docs.length;
  const df: Record<string, number> = Object.fromEntries(q.map((w) => [w, toks.filter((t) => t.includes(w)).length]));
  const avg = toks.reduce((a, t) => a + t.length, 0) / n || 1;
  const scored: [number, Doc][] = [];
  docs.forEach((d, i) => {
    const t = toks[i]; const title = new Set(botTokens(d.title));
    let s = 0, hit = 0;
    for (const w of q) {
      const tf = t.filter((x) => x === w).length;
      if (!tf) continue;
      hit++;
      const idf = Math.log(1 + (n - df[w] + 0.5) / (df[w] + 0.5));
      s += 1 + (idf * tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * t.length) / avg)) + (title.has(w) ? 0.6 : 0);
    }
    if (d.kind === "FAQ") s *= 1.3;
    if (hit && hit / q.length >= 0.5) scored.push([Math.round(s * 1e4) / 1e4, d]);
  });
  return scored.sort((a, b) => b[0] - a[0] || (a[1].id < b[1].id ? -1 : 1));
}

function excerpt(d: Doc, question: string): string {
  if (d.kind === "FAQ") return d.text.split("\n").slice(1).join("\n").trim().slice(0, MAX_ANSWER);
  const sents = d.text.split(/(?<=[.!؟\n])\s+/).map((x) => x.trim()).filter(Boolean);
  const q = new Set(botTokens(question));
  const score = (i: number) => botTokens(sents[i]).filter((w, j, a) => q.has(w) && a.indexOf(w) === j).length;
  const best = sents.map((_, i) => i).sort((a, b) => score(b) - score(a)).slice(0, 3).sort((a, b) => a - b);
  return best.map((i) => sents[i]).join(" ").slice(0, MAX_ANSWER);
}

const R = (text: string, intent: string, sources: BotReply["sources"] = [], action: BotReply["action"] = null): BotReply => ({ text, intent, sources, action });

export function botHandle(textIn: string, st: BotState, joinCodeOk = false): BotReply {
  const t = botNorm(textIn);
  const pols = st.policies ?? [], faqs = st.faqs ?? [], acked = st.acknowledged ?? new Set<string>();
  const hr = st.hr_contact ? `\nللتواصل مع الموارد البشرية: ${st.hr_contact}` : "";
  if (st.member_status === null) {
    const m = t.match(/^(انضمام|join)\s+([a-z0-9]{4,12})$/);
    if (m && joinCodeOk) return R(`استلمنا طلب انضمامك إلى مساعد ${st.org_name ?? ""}. سيصلك إشعار بعد موافقة المسؤول.`, "JOIN", [], { join: m[2] });
    if (m) return R("رمز الانضمام غير صحيح. اطلب الرمز من مسؤول منشأتك.", "JOIN_BAD");
    return R("مرحباً، هذا رقم مساعد حصيف للموظفين. للانضمام أرسل: انضمام ثم رمز منشأتك.", "UNKNOWN");
  }
  if (st.member_status === "PENDING") return R("طلب انضمامك بانتظار موافقة مسؤول المنشأة.", "PENDING");
  if (st.member_status === "REMOVED") return R("اشتراكك في المساعد غير فعّال. تواصل مع مسؤول منشأتك لإعادة تفعيله.", "REMOVED");
  if (st.member_status === "INVITED") {
    if (["موافق", "اوافق", "نعم", "نعم اوافق", "ok", "yes"].includes(t)) {
      const hello = st.welcome || `أهلاً ${st.member_name ?? ""}، أنا مساعد ${st.org_name ?? ""}.`;
      return R(`${hello}\n${BOT_MENU}`, "CONSENT", [], { consent: true });
    }
    if (["ايقاف", "الغاء", "stop"].includes(t)) return R("تم. لن تصلك رسائل من المساعد.", "OPT_OUT", [], { opt_out: true });
    return R(`أضافتك ${st.org_name ?? ""} إلى مساعدها على واتساب. للموافقة أرسل «موافق»، أو «إيقاف» لعدم الاشتراك.`, "INVITE");
  }
  if (["ايقاف", "الغاء الاشتراك", "stop"].includes(t)) return R("تم إيقاف اشتراكك في المساعد. يمكنك العودة بطلب من مسؤول منشأتك.", "OPT_OUT", [], { opt_out: true });
  if (["مساعده", "قائمه", "help", "menu", "مرحبا", "السلام عليكم", "هلا"].includes(t)) return R(`أهلاً ${st.member_name ?? ""}.\n${BOT_MENU}`, "MENU");
  if (["السياسات", "سياسات", "قائمه السياسات"].includes(t)) {
    if (!pols.length) return R("لا توجد سياسات منشورة للموظفين حالياً." + hr, "POLICIES");
    const lines = pols.map((p, i) => `${i + 1}. ${p.title} (إصدار ${p.version})${acked.has(p.id) ? " ✓" : ""}`);
    return R("السياسات المتاحة:\n" + lines.join("\n") + "\n\nأرسل «سياسة» ورقمها للملخص.", "POLICIES");
  }
  let m = t.match(/^(سياسه|policy)\s*(\d{1,2})$/);
  if (m) {
    const i = Number(m[2]);
    if (i < 1 || i > pols.length) return R("رقم السياسة غير موجود. أرسل «السياسات» للقائمة.", "POLICY_BAD");
    const p = pols[i - 1];
    const summary = (p.summary || (p.body || "").replace(/#+\s*/g, "")).slice(0, MAX_ANSWER);
    const tail = acked.has(p.id) ? "\n\n✓ أقررت بالاطلاع على هذا الإصدار." : `\n\nللإقرار بالاطلاع أرسل: أقر ${i}`;
    return R(`«${p.title}» — إصدار ${p.version}\n${summary}${tail}`, "POLICY", [{ kind: "POLICY", id: p.id, title: p.title }]);
  }
  m = t.match(/^(اقر|اقرار|ack)\s*(\d{1,2})$/);
  if (m) {
    const i = Number(m[2]);
    if (i < 1 || i > pols.length) return R("رقم السياسة غير موجود. أرسل «السياسات» للقائمة.", "ACK_BAD");
    const p = pols[i - 1];
    if (acked.has(p.id)) return R(`سبق أن أقررت بالاطلاع على «${p.title}» إصدار ${p.version}.`, "ACK_DUP");
    return R(`تم تسجيل إقرارك بالاطلاع على «${p.title}» إصدار ${p.version}. شكراً لك.`, "ACK",
      [{ kind: "POLICY", id: p.id, title: p.title }], { ack: p.id, version: p.version });
  }
  if (st.quota_left != null && st.quota_left <= 0) return R("بلغت المنشأة حد الأسئلة لهذا الشهر. تواصل مع الموارد البشرية مباشرة." + hr, "QUOTA");
  const docs = chunks(pols, faqs);
  // سؤال شائع كتبه المدير بنفسه يُجاب أولاً، وإلا تُرفض الأسئلة الحساسة قبل البحث في السياسات
  const faqHit = botRank(textIn, docs.filter((d) => d.kind === "FAQ")).filter((x) => x[0] >= MIN_SCORE);
  if (!faqHit.length && SENSITIVE.test(t)) return R("لا أستطيع الإجابة عن الرواتب أو البيانات الشخصية أو المالية. هذه تُطلب مباشرة من الموارد البشرية." + hr, "SENSITIVE");
  const ranked = faqHit.length ? faqHit : botRank(textIn, docs);
  if (!ranked.length || ranked[0][0] < MIN_SCORE) return R("لم أجد إجابة لهذا السؤال في سياسات المنشأة المنشورة. سأحيله للمسؤول." + hr, "NO_ANSWER", [], { escalate: true });
  const best = ranked[0][1];
  const src = best.kind === "FAQ" ? best.ref : best.title + (best.ref.includes(" — ") ? ` (${best.ref.split(" — ").slice(1).join(" — ")})` : "");
  return R(`${excerpt(best, textIn)}\n\nالمصدر: ${src}`, "ANSWER", [{ kind: best.kind, id: best.id, title: best.title, score: ranked[0][0] }]);
}
