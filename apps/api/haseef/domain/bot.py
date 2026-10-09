"""محرك بوت الموظفين (منطق نقي بلا قاعدة بيانات). مطابق لـ packages/shared/src/bot.ts — تُختبر المطابقة بنفس الحالات.

  * يجيب فقط من محتوى سمح المدير بمشاركته: السياسات المعلَّمة «للموظفين» والأسئلة الشائعة التي أضافها.
    ما لم يُشارك لا يدخل أصلاً في معرفة البوت، فلا يمكن استخراجه بأي صياغة.
  * أسئلة الرواتب والبيانات الشخصية والمالية تُرفض وتُحال للموارد البشرية حتى لو وُجدت كلمات مطابقة.
  * كل إجابة تذكر مصدرها، وإن لم يجد إجابة كافية يقول ذلك صراحة.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

_DIAC = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭـ]")
_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
_STOP_RAW = set("""في من على عن الى إلى ما ماذا هل كيف متى لماذا اين أين هو هي هم ان أن او أو و يا لي لنا عند مع هذا هذه ذلك تلك التي الذي
كم اي أي ممكن ابي ابغى اريد أريد ودي لو بعد قبل كل بين حول الشركه الشركة المنشاه المنشأة عندنا عندكم لدينا
وش ايش شو موظف الموظف الموظفين موظفين يبدا يبدأ ينتهي يكون يصير""".split())
SENSITIVE = re.compile(r"(راتب|رواتب|مرتب|اجور|ايبان|حساب بنكي|رقم الهويه|هويه|جواز|ارباح|ميزانيه|مبيعات|ايرادات|عقد (موظف|زميل)|بيانات (موظف|زميل)|كلمه المرور|باسورد)")
SYN = {"دوام": "عمل", "شغل": "عمل", "اوقات": "ساعات", "اجازت": "اجازه", "عطله": "اجازه", "عطل": "اجازه",
       "تاخر": "تاخير", "غياب": "غياب", "انصراف": "انصراف", "بدل": "بدل", "سفر": "سفر", "انتداب": "سفر"}
MIN_SCORE = 1.2
MAX_ANSWER = 700


def norm(s: str) -> str:
    s = _DIAC.sub("", s.translate(_AR_DIGITS)).lower()
    s = re.sub("[إأآٱ]", "ا", s).replace("ى", "ي").replace("ة", "ه").replace("ؤ", "و").replace("ئ", "ي")
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", s)).strip()


STOP = {norm(w) for w in _STOP_RAW}


def stem(w: str) -> str:
    for p in ("وال", "بال", "كال", "فال", "لل", "ال"):
        if w.startswith(p) and len(w) - len(p) >= 3:
            w = w[len(p):]
            break
    else:
        if w[:1] in ("ب", "و", "ف", "ك", "ل") and len(w) >= 5:
            w = w[1:]
    for suf in ("ات", "ون", "ين", "ها", "هم"):
        if w.endswith(suf) and len(w) - len(suf) >= 3:
            w = w[: -len(suf)]
            break
    return w


def tokens(s: str) -> list[str]:
    out = []
    for w in norm(s).split():
        if w in STOP or len(w) < 2:
            continue
        w = stem(w)
        out.append(SYN.get(w, w))
    return out


@dataclass
class Doc:
    id: str
    kind: str          # FAQ | POLICY
    title: str
    text: str
    ref: str = ""      # رقم السياسة في قائمة البوت أو عنوان القسم


@dataclass
class Policy:
    id: str
    title: str
    version: str
    body: str
    summary: str | None = None


@dataclass
class State:
    member_status: str | None          # None = رقم غير معروف
    member_name: str = ""
    org_name: str = ""
    hr_contact: str | None = None
    welcome: str | None = None
    policies: list[Policy] = field(default_factory=list)
    faqs: list[tuple[str, str, str]] = field(default_factory=list)       # (id, سؤال, جواب)
    acknowledged: set[str] = field(default_factory=set)                   # policy ids
    quota_left: int | None = None


@dataclass
class Reply:
    text: str
    intent: str
    sources: list[dict] = field(default_factory=list)
    action: dict | None = None         # تغيير حالة يطبقه المستدعي: consent / opt_out / join / ack


def chunks(policies: list[Policy], faqs: list[tuple[str, str, str]]) -> list[Doc]:
    out = [Doc(f"faq:{i}", "FAQ", q, f"{q}\n{a}", "سؤال شائع") for i, q, a in faqs]
    for n, p in enumerate(policies, 1):
        parts = [x.strip() for x in re.split(r"\n(?=#+ )|\n\s*\n", p.body or "") if x.strip()]
        for k, part in enumerate(parts):
            head = re.match(r"#+\s*(.+)", part)
            out.append(Doc(f"pol:{p.id}:{k}", "POLICY", p.title, re.sub(r"^#+\s*", "", part, flags=re.M), f"سياسة {n}" + (f" — {head.group(1)[:60]}" if head else "")))
    return out


def rank(question: str, docs: list[Doc]) -> list[tuple[float, Doc]]:
    q = set(tokens(question))
    if not q or not docs:
        return []
    toks = [tokens(d.title + " " + d.text) for d in docs]
    n = len(docs)
    df = {w: sum(1 for t in toks if w in t) for w in q}
    avg = sum(len(t) for t in toks) / n or 1
    scored = []
    for d, t in zip(docs, toks):
        title = set(tokens(d.title))
        s, hit = 0.0, 0
        for w in q:
            tf = t.count(w)
            if not tf:
                continue
            hit += 1
            idf = math.log(1 + (n - df[w] + 0.5) / (df[w] + 0.5))
            s += 1 + idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * len(t) / avg)) + (0.6 if w in title else 0)
        if d.kind == "FAQ":
            s *= 1.3
        if hit and hit / len(q) >= 0.5:
            scored.append((round(s, 4), d))
    scored.sort(key=lambda x: (-x[0], x[1].id))
    return scored


def _excerpt(d: Doc, question: str) -> str:
    if d.kind == "FAQ":
        return d.text.split("\n", 1)[1].strip()[:MAX_ANSWER]
    sents = [x.strip() for x in re.split(r"(?<=[.!؟\n])\s+", d.text) if x.strip()]
    q = set(tokens(question))
    best = sorted(range(len(sents)), key=lambda i: -len(q & set(tokens(sents[i]))))[:3]
    txt = " ".join(sents[i] for i in sorted(best))
    return txt[:MAX_ANSWER]


MENU = ("اكتب سؤالك مباشرة، مثل: كم أيام الإجازة السنوية؟\n"
        "أو استخدم الأوامر:\n• «السياسات» لقائمة السياسات\n• «سياسة 2» لملخص سياسة\n• «أقر 2» للإقرار بالاطلاع عليها\n• «إيقاف» لإلغاء الاشتراك")


def handle(text_in: str, st: State, *, join_code_ok: bool = False) -> Reply:
    t = norm(text_in)
    hr = f"\nللتواصل مع الموارد البشرية: {st.hr_contact}" if st.hr_contact else ""

    if st.member_status is None:
        m = re.match(r"^(انضمام|join)\s+([a-z0-9]{4,12})$", t)
        if m and join_code_ok:
            return Reply(f"استلمنا طلب انضمامك إلى مساعد {st.org_name}. سيصلك إشعار بعد موافقة المسؤول.", "JOIN", action={"join": m.group(2)})
        if m:
            return Reply("رمز الانضمام غير صحيح. اطلب الرمز من مسؤول منشأتك.", "JOIN_BAD")
        return Reply("مرحباً، هذا رقم مساعد حصيف للموظفين. للانضمام أرسل: انضمام ثم رمز منشأتك.", "UNKNOWN")
    if st.member_status == "PENDING":
        return Reply("طلب انضمامك بانتظار موافقة مسؤول المنشأة.", "PENDING")
    if st.member_status == "REMOVED":
        return Reply("اشتراكك في المساعد غير فعّال. تواصل مع مسؤول منشأتك لإعادة تفعيله.", "REMOVED")
    if st.member_status == "INVITED":
        if t in ("موافق", "اوافق", "نعم", "نعم اوافق", "ok", "yes"):
            hello = st.welcome or f"أهلاً {st.member_name}، أنا مساعد {st.org_name}."
            return Reply(f"{hello}\n{MENU}", "CONSENT", action={"consent": True})
        if t in ("ايقاف", "الغاء", "stop"):
            return Reply("تم. لن تصلك رسائل من المساعد.", "OPT_OUT", action={"opt_out": True})
        return Reply(f"أضافتك {st.org_name} إلى مساعدها على واتساب. للموافقة أرسل «موافق»، أو «إيقاف» لعدم الاشتراك.", "INVITE")

    # ACTIVE
    if t in ("ايقاف", "الغاء الاشتراك", "stop"):
        return Reply("تم إيقاف اشتراكك في المساعد. يمكنك العودة بطلب من مسؤول منشأتك.", "OPT_OUT", action={"opt_out": True})
    if t in ("مساعده", "قائمه", "help", "menu", "مرحبا", "السلام عليكم", "هلا"):
        return Reply(f"أهلاً {st.member_name}.\n{MENU}", "MENU")
    if t in ("السياسات", "سياسات", "قائمه السياسات"):
        if not st.policies:
            return Reply("لا توجد سياسات منشورة للموظفين حالياً." + hr, "POLICIES")
        lines = [f"{i}. {p.title} (إصدار {p.version}){' ✓' if p.id in st.acknowledged else ''}" for i, p in enumerate(st.policies, 1)]
        return Reply("السياسات المتاحة:\n" + "\n".join(lines) + "\n\nأرسل «سياسة» ورقمها للملخص.", "POLICIES")
    m = re.match(r"^(سياسه|policy)\s*(\d{1,2})$", t)
    if m:
        i = int(m.group(2))
        if not 1 <= i <= len(st.policies):
            return Reply("رقم السياسة غير موجود. أرسل «السياسات» للقائمة.", "POLICY_BAD")
        p = st.policies[i - 1]
        summary = (p.summary or re.sub(r"#+\s*", "", p.body or ""))[:MAX_ANSWER]
        tail = "\n\n✓ أقررت بالاطلاع على هذا الإصدار." if p.id in st.acknowledged else f"\n\nللإقرار بالاطلاع أرسل: أقر {i}"
        return Reply(f"«{p.title}» — إصدار {p.version}\n{summary}{tail}", "POLICY", [{"kind": "POLICY", "id": p.id, "title": p.title}])
    m = re.match(r"^(اقر|اقرار|ack)\s*(\d{1,2})$", t)
    if m:
        i = int(m.group(2))
        if not 1 <= i <= len(st.policies):
            return Reply("رقم السياسة غير موجود. أرسل «السياسات» للقائمة.", "ACK_BAD")
        p = st.policies[i - 1]
        if p.id in st.acknowledged:
            return Reply(f"سبق أن أقررت بالاطلاع على «{p.title}» إصدار {p.version}.", "ACK_DUP")
        return Reply(f"تم تسجيل إقرارك بالاطلاع على «{p.title}» إصدار {p.version}. شكراً لك.", "ACK",
                     [{"kind": "POLICY", "id": p.id, "title": p.title}], action={"ack": p.id, "version": p.version})

    if st.quota_left is not None and st.quota_left <= 0:
        return Reply("بلغت المنشأة حد الأسئلة لهذا الشهر. تواصل مع الموارد البشرية مباشرة." + hr, "QUOTA")
    docs = chunks(st.policies, st.faqs)
    # سؤال شائع كتبه المدير بنفسه يُجاب أولاً (مثل «متى تصرف الرواتب؟»)، وإلا تُرفض الأسئلة الحساسة قبل البحث في السياسات
    faq_hit = [x for x in rank(text_in, [d for d in docs if d.kind == "FAQ"]) if x[0] >= MIN_SCORE]
    if not faq_hit and SENSITIVE.search(t):
        return Reply("لا أستطيع الإجابة عن الرواتب أو البيانات الشخصية أو المالية. هذه تُطلب مباشرة من الموارد البشرية." + hr, "SENSITIVE")
    ranked = faq_hit or rank(text_in, docs)
    if not ranked or ranked[0][0] < MIN_SCORE:
        return Reply("لم أجد إجابة لهذا السؤال في سياسات المنشأة المنشورة. سأحيله للمسؤول." + hr, "NO_ANSWER", action={"escalate": True})
    best = ranked[0][1]
    src = best.ref if best.kind == "FAQ" else f"{best.title}" + (f" ({best.ref.split(' — ', 1)[1]})" if " — " in best.ref else "")
    return Reply(f"{_excerpt(best, text_in)}\n\nالمصدر: {src}", "ANSWER",
                 [{"kind": best.kind, "id": best.id, "title": best.title, "score": ranked[0][0]}])
