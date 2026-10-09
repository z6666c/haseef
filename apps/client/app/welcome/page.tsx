"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { INTEREST_LABEL, LEGAL_TYPE_LABEL, type PublicPricing, type TrialInput } from "@haseef/shared";
import { LegalFooter } from "@/components/LegalDoc";
import { Logo } from "@/components/Logo";
import { api } from "@/lib/session";

const PLANS = [
  { key: "ESSENTIAL", name: "الأساس", m: 219, y: 2190, for: "المؤسسات والمنشآت الناشئة",
    items: ["التراخيص والوثائق وتنبيهاتها", "200 رسالة واتساب شهرياً", "الالتزامات النظامية حسب كيانك", "العمل والموظفين: التأمينات وحماية الأجور وقوى", "المكتبة المرجعية"] },
  { key: "PROFESSIONAL_GRC", name: "الحوكمة والنمو", m: 549, y: 5490, for: "الشركات النامية", featured: true,
    items: ["كل ما في الأساس", "هيكل الحوكمة وفحصه على 30 معياراً", "السياسات: تبنٍّ واعتماد ومراجعة", "مركز حماية البيانات وتقييم الأثر", "1,000 رسالة واتساب شهرياً", "خصم 15% على الاستشارات القانونية"] },
  { key: "ENTERPRISE", name: "كبار العملاء", m: 1429, y: 14290, for: "المجموعات وشركات المساهمة",
    items: ["كل ما في الحوكمة والنمو", "لوحة موحدة لعدة منشآت وفروع", "تقرير مجلس الإدارة السنوي", "رسائل بلا حد", "خصم 25% على الاستشارات القانونية"] },
] as const;

const FEATURES = [
  { t: "رادار التراخيص وتنبيهاتها", d: "كل وثيقة لها تاريخ انتهاء في قائمة واحدة، وتنبيه بالواتساب والبريد قبل الانتهاء بـ 60 و30 و14 و7 أيام لمن تختاره." },
  { t: "مؤشر حصافة", d: "رقم من 100 يلخص وضع منشأتك، ويقول لك بالضبط ما الذي يخفضه وكيف ترفعه." },
  { t: "الحوكمة وهيكل الشركة", d: "قالب جاهز حسب كيانك ورسم هيكلي، وفحص آلي على متطلبات نظام الشركات ولائحة الحوكمة." },
  { t: "73 نموذجاً جاهزاً", d: "سياسات ولوائح مجلس ولجان وقرارات ومحاضر وعقد تأسيس ولائحة عمل، تتبناها وتعدلها في دقائق." },
  { t: "حماية البيانات الشخصية", d: "سجل المعالجة، طلبات أصحاب البيانات بمهلة 30 يوماً، الحوادث بعدّاد 72 ساعة، وتقييم الأثر." },
  { t: "العمل والموظفين", d: "تقويم شهري لسداد التأمينات ورفع ملف حماية الأجور في مُدد وصرف الرواتب، وتنبيه قبل انتهاء الإقامات ورخص العمل والعقود." },
  { t: "الزكاة والضريبة", d: "مواعيد إقرارات القيمة المضافة والاستقطاع والزكاة بتنبيهات قبل الموعد، ومزامنة كل المواعيد مع تقويم جوجل والآيفون." },
  { t: "الحضور بالموقع وبصمة الجوال", d: "يسجّل الموظف حضوره من جواله داخل نطاق المنشأة فقط وبعد التحقق ببصمته، بلا أجهزة بصمة ولا تطبيقات، مع تقرير شهري للتأخير والغياب." },
  { t: "الإجازات والخصومات", d: "إجازات سنوية واعتيادية واضطرارية ومرضية يرفعها الموظف من جواله أو واتساب، والمباشرة بعد العودة، وإشعارات خصم بضوابط نظام العمل وحق الاعتراض." },
  { t: "تقويم المناسبات", d: "العطل الرسمية والمناسبات الوطنية والدينية، وتهنئة موظفيك على واتساب باسم منشأتك مجاناً." },
  { t: "بوت الموظفين على واتساب", d: "يجيب موظفيك عن الإجازات والدوام والإجراءات من سياساتك المنشورة فقط، ويسجّل إقرارهم بالاطلاع عليها." },
  { t: "فاحص العقود", d: "الصق عقد العمل أو سياسة الخصوصية لترى البنود المخالفة ورقم المادة والصياغة البديلة، والفحص داخل متصفحك." },
  { t: "محامٍ بالساعة", d: "استشارة مع محامٍ مرخّص بسعر معلن قبل الطلب، بلا عقود ولا أتعاب مفتوحة." },
  { t: "تقرير للمجلس", d: "تقرير سنوي رسمي عن الحوكمة والامتثال جاهز للطباعة والعرض على المجلس أو الشركاء." },
];

const FAQ = [
  { q: "هل أحتاج خبرة قانونية لاستخدام حصيف؟", a: "لا. حصيف يحدد الالتزامات المنطبقة على منشأتك حسب نوعها وحجمها، ويعطيك نماذج جاهزة وتنبيهات. وعند الحاجة تحجز ساعة مع محامٍ مرخّص." },
  { q: "أين تُحفظ بيانات منشأتي؟", a: "داخل المملكة العربية السعودية، معزولة لكل منشأة على مستوى قاعدة البيانات، مع سجل تدقيق لا يُعدَّل." },
  { q: "هل النماذج بديل عن المحامي؟", a: "النماذج نقطة بداية مهنية تختصر الوقت والتكلفة، وتُكيَّف مع نشاطك. للقرارات الحساسة ننصح بمراجعة محامٍ، ويمكنك ذلك من داخل المنصة." },
  { q: "هل يمكنني الإلغاء في أي وقت؟", a: "نعم. الاشتراك شهري أو سنوي بخصم شهرين، ويمكن الإلغاء قبل التجديد دون رسوم إضافية." },
  { q: "هل يناسب حصيف مكاتب المحاسبة والاستشارات؟", a: "نعم. يدير المستشار عدة منشآت بحساب واحد، ونوفر برنامج شراكة للمكاتب." },
];

const EMPTY: TrialInput = { full_name: "", company_name: "", email: "", phone_number: null, legal_type: null, employees_range: null,
  plan_interest: "UNSURE", interests: [], message: null, source: "landing", consent: false, website: "" };

export default function WelcomePage() {
  const [yearly, setYearly] = useState(false);
  const [pricing, setPricing] = useState<PublicPricing | null>(null);
  useEffect(() => { api.publicPricing().then(setPricing).catch(() => {}); }, []);   // الأسعار من غرفة العمليات
  const priceOf = (tier: string, fallback: [number, number]) => {
    const x = pricing?.plans.find((p) => p.tier === tier);
    return x ? [x.monthly_price_sar, x.yearly_price_sar] : fallback;
  };
  const extras = (pricing?.addons ?? []).filter((a) => a.is_active !== false);
  /** سطر لكل مجموعة إضافات: الموارد البشرية (أقل شريحة)، البوت، والحزمة. */
  const addonLines = (tier: string): string[] => {
    if (!extras.length) return [];
    if (extras.every((a) => a.included_tiers.includes(tier))) return ["الموارد البشرية وبوت الموظفين: مشمولة"];
    const hr = extras.filter((a) => a.code === "ATTENDANCE" || (a.limits.grants?.length === 1 && a.limits.grants[0] === "ATTENDANCE"));
    const bot = extras.find((a) => a.code === "WA_BOT"), bundle = extras.find((a) => a.code === "STAFF_BUNDLE");
    const out: string[] = [];
    if (hr.length) out.push(hr.some((a) => a.included_tiers.includes(tier)) ? "الموارد البشرية: مشمولة"
      : `الموارد البشرية: من ${Math.min(...hr.map((a) => a.monthly_price))} ريال/شهر (حتى ${Math.max(...hr.map((a) => a.limits.members ?? 0))} موظفاً)`);
    if (bot) out.push(bot.included_tiers.includes(tier) ? "بوت الموظفين: مشمول" : `بوت الموظفين: ${bot.monthly_price} ريال/شهر`);
    if (bundle && !bundle.included_tiers.includes(tier)) out.push(`أو حزمة الموظفين (الاثنين): ${bundle.monthly_price} ريال/شهر`);
    return out;
  };
  const [f, setF] = useState<TrialInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pick(plan: TrialInput["plan_interest"]) {
    setF((x) => ({ ...x, plan_interest: plan }));
    document.getElementById("trial")?.scrollIntoView({ behavior: "smooth" });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.submitTrial({ ...f, message: f.message?.trim() || null, phone_number: f.phone_number?.trim() || null });
      setDone(true);
    } catch (err) { setError(err instanceof Error ? err.message : "تعذّر إرسال الطلب، حاول مرة أخرى"); }
    finally { setBusy(false); }
  }

  return (
    <div className="lp">
      <header className="lp-nav">
        <Link href="/welcome" aria-label="حَصيف"><Logo variant="compact" /></Link>
        <nav aria-label="أقسام الصفحة">
          <a href="#features">المزايا</a><a href="#plans">الباقات</a><a href="#security">الأمان</a><a href="#faq">الأسئلة</a>
        </nav>
        <div className="lp-nav-cta">
          <Link className="btn btn-quiet" href="/login">تسجيل الدخول</Link>
          <Link className="btn btn-action" href="/signup">ابدأ مجاناً</Link>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-text">
          <p className="lp-kicker">منصة سعودية للحوكمة والامتثال وحماية البيانات</p>
          <h1>كل التزامات منشأتك<br />في رادار واحد.</h1>
          <p className="lp-lead">حصيف يتابع تراخيصك ويذكّرك قبل انتهائها، ويبني هيكل حوكمتك وسياساتك من نماذج جاهزة،
            ويجهّزك لنظام حماية البيانات الشخصية — بالعربية، وبيانات داخل المملكة، من {priceOf("ESSENTIAL", [219, 2190])[0]} ريالاً شهرياً.</p>
          <div className="lp-cta">
            <Link className="btn btn-action lp-btn-lg" href="/signup">ابدأ مجاناً 14 يوماً</Link>
            <Link className="btn btn-quiet lp-btn-lg" href="/login">جرّب النسخة التجريبية</Link>
          </div>
          <ul className="lp-trust">
            <li>بيانات داخل المملكة</li><li>عربي بالكامل</li><li>بلا عقود طويلة</li>
          </ul>
        </div>
        <div className="lp-hero-visual" aria-hidden="true">
          <div className="lp-card lp-score">
            <span className="lp-muted">مؤشر حصافة</span>
            <b>82<small>/100</small></b>
            <div className="lp-bars">
              <div><span>الامتثال التشغيلي</span><i style={{ width: "78%" }} /></div>
              <div><span>الحوكمة وحماية البيانات</span><i style={{ width: "86%" }} /></div>
              <div><span>العقود واللوائح</span><i style={{ width: "81%" }} /></div>
            </div>
          </div>
          <div className="lp-card lp-alerts">
            <span className="lp-muted">تنبيهات قادمة</span>
            <ul>
              <li><em data-r="CRITICAL">خلال 3 أيام</em> رخصة بلدي — الفرع الرئيسي</li>
              <li><em data-r="HIGH">خلال 14 يوماً</em> شهادة الدفاع المدني</li>
              <li><em>خلال 30 يوماً</em> مراجعة سياسة الخصوصية</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="lp-stats" aria-label="أرقام">
        <div><b>1.7 مليون</b><span>سجل تجاري قائم في المملكة، كلها لها مواعيد والتزامات</span></div>
        <div><b>33</b><span>التزاماً نظامياً نتابعها حسب نوع منشأتك</span></div>
        <div><b>72 ساعة</b><span>مهلة الإبلاغ عن تسرب البيانات — والعدّاد جاهز</span></div>
        <div><b>73</b><span>نموذجاً كاملاً جاهزاً للتبني</span></div>
      </section>

      <section className="lp-section" id="features">
        <h2>ما الذي يقدمه حصيف</h2>
        <p className="lp-sub">بديل عملي عن موظف امتثال متفرغ وجداول التذكير المتفرقة.</p>
        <div className="lp-features">
          {FEATURES.map((x) => <div key={x.t} className="lp-feature"><h3>{x.t}</h3><p>{x.d}</p></div>)}
        </div>
      </section>

      <section className="lp-section lp-steps">
        <h2>تبدأ في ثلاث خطوات</h2>
        <ol>
          <li><b>سجّل منشأتك</b><span>السجل التجاري ونوع الكيان، فيظهر لك الهيكل الأساسي والالتزامات المنطبقة تلقائياً.</span></li>
          <li><b>أضف وثائقك</b><span>التراخيص والشهادات بتواريخها، وتبنَّ السياسات المطلوبة من المكتبة.</span></li>
          <li><b>اطمئن</b><span>تنبيهات قبل كل موعد، ومؤشر يوضح وضعك، وتقرير جاهز للمجلس.</span></li>
        </ol>
      </section>

      <section className="lp-section" id="plans">
        <h2>باقات واضحة</h2>
        {pricing?.promo?.active && <p style={{ textAlign: "center" }}><span className="lp-promo">🎁 عرض الإطلاق: شهر مجاني على إضافة الموارد البشرية لأول 50 مشتركاً — المتبقي {pricing.promo.remaining}</span></p>}
        <div className="lp-toggle" role="radiogroup" aria-label="دورة الدفع">
          <button type="button" role="radio" aria-checked={!yearly} onClick={() => setYearly(false)}>شهري</button>
          <button type="button" role="radio" aria-checked={yearly} onClick={() => setYearly(true)}>سنوي <small>شهران مجاناً</small></button>
        </div>
        <div className="lp-plans">
          {PLANS.map((p) => (
            <div key={p.key} className="lp-plan" data-featured={"featured" in p || undefined}>
              {"featured" in p && <span className="lp-badge">الأكثر طلباً</span>}
              <h3>{p.name}</h3>
              <p className="lp-muted">{p.for}</p>
              <p className="lp-price"><b>{priceOf(p.key, [p.m, p.y])[yearly ? 1 : 0].toLocaleString("en-US")}</b> ريال / {yearly ? "سنة" : "شهر"}</p>
              <ul>{p.items.map((i) => <li key={i}>{i}</li>)}
                {addonLines(p.key).map((t) => <li key={t}>{t}</li>)}</ul>
              <Link className={`btn ${"featured" in p ? "btn-action" : "btn-quiet"}`} href="/signup">ابدأ مجاناً 14 يوماً</Link>
              <button type="button" className="link-btn small" onClick={() => pick(p.key)}>أو اطلب عرضاً من فريقنا</button>
            </div>
          ))}
        </div>
        <p className="lp-note">الأسعار قبل ضريبة القيمة المضافة. استشارة المحامي بالساعة من 650 ريالاً، بسعر معلن قبل الطلب.</p>
      </section>

      <section className="lp-section lp-security" id="security">
        <div>
          <h2>بياناتك في أمان، وداخل المملكة</h2>
          <p>بنينا حصيف على ما نطلبه من عملائنا: الاستضافة والمعالجة داخل المملكة، عزل بيانات كل منشأة في قاعدة البيانات نفسها،
            سجل تدقيق لا يُعدَّل ولا يُحذف، وصلاحيات مفصولة داخل فريقنا.</p>
        </div>
        <ul>
          <li>عزل كامل بين المنشآت</li><li>سجل تدقيق دائم</li><li>صلاحيات حسب الدور لفريقك</li><li>متوافق مع نظام حماية البيانات الشخصية</li>
        </ul>
      </section>

      <section className="lp-section" id="faq">
        <h2>أسئلة شائعة</h2>
        <div className="lp-faq">
          {FAQ.map((x) => <details key={x.q}><summary>{x.q}</summary><p>{x.a}</p></details>)}
        </div>
      </section>

      <section className="lp-section lp-trial" id="trial">
        <div className="lp-trial-intro">
          <h2>اطلب تجربة مجانية</h2>
          <p>نجهّز لك حساباً تجريبياً لمدة 14 يوماً، ونتواصل معك خلال يوم عمل لعرض المنصة على بيانات منشأتك.</p>
          <ul><li>بلا بطاقة دفع</li><li>إعداد مجاني للهيكل والالتزامات</li><li>دعم بالعربية</li></ul>
        </div>
        {done ? (
          <div className="lp-done" role="status">
            <h3>وصلنا طلبك، شكراً لك.</h3>
            <p>سيتواصل معك فريق حصيف خلال يوم عمل على البريد {f.email}{f.phone_number ? " أو الجوال" : ""}. حتى ذلك الحين يمكنك تجربة النسخة التجريبية.</p>
            <Link className="btn btn-action" href="/login">افتح النسخة التجريبية</Link>
          </div>
        ) : (
          <form className="lp-form" onSubmit={submit} noValidate={false}>
            <div className="grid">
              <div className="field"><label htmlFor="tn">الاسم</label>
                <input id="tn" required minLength={2} autoComplete="name" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></div>
              <div className="field"><label htmlFor="tc">اسم المنشأة</label>
                <input id="tc" required minLength={2} autoComplete="organization" value={f.company_name} onChange={(e) => setF({ ...f, company_name: e.target.value })} /></div>
              <div className="field"><label htmlFor="te">البريد الإلكتروني</label>
                <input id="te" type="email" required dir="ltr" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
              <div className="field"><label htmlFor="tp">الجوال (اختياري)</label>
                <input id="tp" type="tel" dir="ltr" placeholder="05XXXXXXXX" pattern="(\+?9665\d{8})|(05\d{8})" autoComplete="tel"
                       value={f.phone_number ?? ""} onChange={(e) => setF({ ...f, phone_number: e.target.value || null })} /></div>
              <div className="field"><label htmlFor="tl">نوع الكيان</label>
                <select id="tl" value={f.legal_type ?? ""} onChange={(e) => setF({ ...f, legal_type: e.target.value || null })}>
                  <option value="">اختر</option>
                  {Object.entries(LEGAL_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  <option value="OTHER">أخرى</option>
                </select></div>
              <div className="field"><label htmlFor="ts">عدد الموظفين</label>
                <select id="ts" value={f.employees_range ?? ""} onChange={(e) => setF({ ...f, employees_range: (e.target.value || null) as TrialInput["employees_range"] })}>
                  <option value="">اختر</option><option value="1-9">1 – 9</option><option value="10-49">10 – 49</option>
                  <option value="50-249">50 – 249</option><option value="250+">250 فأكثر</option>
                </select></div>
              <div className="field"><label htmlFor="tpl">الباقة المهتم بها</label>
                <select id="tpl" value={f.plan_interest} onChange={(e) => setF({ ...f, plan_interest: e.target.value as TrialInput["plan_interest"] })}>
                  <option value="UNSURE">لم أقرر بعد</option>
                  {PLANS.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
                </select></div>
            </div>
            <fieldset className="lp-interests">
              <legend>ما الذي يهمك أكثر؟</legend>
              {Object.entries(INTEREST_LABEL).map(([k, l]) => (
                <label key={k}><input type="checkbox" checked={f.interests.includes(k)}
                  onChange={(e) => setF({ ...f, interests: e.target.checked ? [...f.interests, k] : f.interests.filter((x) => x !== k) })} /> {l}</label>
              ))}
            </fieldset>
            <div className="field"><label htmlFor="tm">ملاحظات (اختياري)</label>
              <textarea id="tm" rows={3} maxLength={2000} value={f.message ?? ""} onChange={(e) => setF({ ...f, message: e.target.value })} /></div>
            <div className="lp-hp" aria-hidden="true">
              <label htmlFor="tw">الموقع</label>
              <input id="tw" tabIndex={-1} autoComplete="off" value={f.website ?? ""} onChange={(e) => setF({ ...f, website: e.target.value })} />
            </div>
            <label className="lp-consent">
              <input type="checkbox" required checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} />
              <span>أوافق على تواصل فريق حصيف معي ومعالجة هذه البيانات لهذا الغرض وفق <Link href="/privacy">سياسة الخصوصية</Link>.</span>
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn btn-action lp-btn-lg" type="submit" disabled={busy || !f.consent}>{busy ? "جارٍ الإرسال…" : "أرسل الطلب"}</button>
          </form>
        )}
      </section>

      <LegalFooter />
    </div>
  );
}
