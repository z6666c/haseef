/**
 * فاحص العقود — المرحلة الأولى: فحص بالقواعد يعمل كاملاً داخل متصفح المستخدم.
 *
 * لماذا قواعد قبل الذكاء الاصطناعي؟ لا يغادر نص العقد جهاز المستخدم، والنتيجة ثابتة وقابلة للتفسير،
 * ويعمل اليوم دون انتظار اعتماد مزوّد نموذج لغوي داخل المملكة. التحليل بالذكاء الاصطناعي (المرحلة 2)
 * يضيف فهم الصياغات غير المتوقعة، ويستخدم redactPii نفسها قبل أي إرسال.
 *
 * الحدود: القواعد تلتقط الصياغات الشائعة فقط، وأرقام المواد تُراجع قانونياً قبل الإطلاق.
 */

export type ContractKind = "LABOR_CONTRACT" | "PRIVACY_POLICY";
export type FindingSeverity = "VIOLATION" | "WARNING";
export type ContractVerdict = "COMPLIANT" | "CONTAINS_VIOLATIONS" | "HIGH_RISK";

export interface ContractFinding {
  id: string;
  severity: FindingSeverity;
  title: string;
  excerpt: string | null;          // النص كما ورد في الوثيقة (بعد الحجب)
  law: string | null;              // النظام والمادة
  explanation: string;
  suggestion: string | null;       // صياغة بديلة مقترحة
}

export interface ContractCheckResult {
  kind: ContractKind;
  verdict: ContractVerdict;
  percentage: number;
  findings: ContractFinding[];
  passed: string[];                // البنود التي اجتازت الفحص
  redaction: { text: string; counts: Record<string, number> };
}

export const CONTRACT_KIND_LABEL: Record<ContractKind, string> = {
  LABOR_CONTRACT: "عقد عمل",
  PRIVACY_POLICY: "سياسة خصوصية",
};
export const CONTRACT_VERDICT_LABEL: Record<ContractVerdict, string> = {
  COMPLIANT: "متوافق",
  CONTAINS_VIOLATIONS: "يحتوي مخالفات",
  HIGH_RISK: "عالي الخطورة",
};
export const PII_LABEL: Record<string, string> = {
  IBAN: "آيبان", EMAIL: "بريد إلكتروني", PHONE: "جوال", NATIONAL_ID: "هوية/إقامة",
};

// ---------------------------------------------------------------- حجب البيانات الشخصية
// مطابق لـ apps/api/haseef/domain/pii.py (الترتيب مهم: الآيبان قبل الهوية).
const PII_PATTERNS: [string, RegExp][] = [
  ["IBAN", /\bSA\d{2}(?:\s?[0-9A-Z]{4}){5}\b/gi],
  ["EMAIL", /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g],
  ["PHONE", /(?<!\d)(?:\+966|00966|0)\s?5\d(?:[\s-]?\d){7}(?!\d)/g],
  ["NATIONAL_ID", /(?<!\d)[12]\d{9}(?!\d)/g],
];

export function normalizeDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function redactPii(text: string): { text: string; mapping: Record<string, string>; counts: Record<string, number> } {
  let out = normalizeDigits(text);
  const mapping: Record<string, string> = {};
  const seen = new Map<string, string>();
  const counts: Record<string, number> = {};
  for (const [kind, re] of PII_PATTERNS) {
    out = out.replace(re, (value) => {
      const prev = seen.get(value);
      if (prev) return prev;
      counts[kind] = (counts[kind] ?? 0) + 1;
      const token = `[${kind}_${counts[kind]}]`;
      seen.set(value, token);
      mapping[token] = value;
      return token;
    });
  }
  return { text: out, mapping, counts };
}

// ---------------------------------------------------------------- الأعداد والمدد
const AR = "\\u0600-\\u06FF";
const UNITS: [string, number][] = [
  ["واحد", 1], ["واحدة", 1], ["اثنين", 2], ["اثنتين", 2], ["اثنان", 2], ["ثلاث", 3], ["ثلاثة", 3], ["أربع", 4], ["أربعة", 4],
  ["خمس", 5], ["خمسة", 5], ["ست", 6], ["ستة", 6], ["سبع", 7], ["سبعة", 7], ["ثمان", 8], ["ثماني", 8], ["ثمانية", 8],
  ["تسع", 9], ["تسعة", 9], ["عشر", 10], ["عشرة", 10],
];
const TENS: [string, number][] = [
  ["عشرون", 20], ["عشرين", 20], ["ثلاثون", 30], ["ثلاثين", 30], ["أربعون", 40], ["أربعين", 40], ["خمسون", 50], ["خمسين", 50],
  ["ستون", 60], ["ستين", 60], ["سبعون", 70], ["سبعين", 70], ["ثمانون", 80], ["ثمانين", 80], ["تسعون", 90], ["تسعين", 90],
  ["مائة", 100], ["مئة", 100], ["مائتين", 200], ["مئتين", 200],
];
const word = (w: string) => `(?<![${AR}])([وبل]?)${w}(?![${AR}])`;
const alt = (xs: [string, number][]) => xs.map(([w]) => w).sort((a, b) => b.length - a.length).join("|");
const VALUE: Record<string, number> = Object.fromEntries([...UNITS, ...TENS]);

/** يحوّل الأعداد المكتوبة بالحروف إلى أرقام: «خمسة عشر يوماً» ← «15 يوماً». */
export function wordsToNumbers(s: string): string {
  let t = normalizeDigits(s).replace(/[إأآ]حد عشر/g, "11").replace(/اثن[اتي]+ عشر[ة]?/g, "12");
  // واحد وعشرون، خمسة وأربعون...
  t = t.replace(new RegExp(word(`(${alt(UNITS)})\\s+و\\s*(${alt(TENS)})`), "g"),
    (_m, p: string, u: string, te: string) => `${p}${VALUE[u] + VALUE[te]}`);
  // ثلاثة عشر...
  t = t.replace(new RegExp(word(`(${alt(UNITS)})\\s+عشر[ة]?`), "g"), (_m, p: string, u: string) => `${p}${VALUE[u] + 10}`);
  t = t.replace(new RegExp(word(`(${alt(TENS)})`), "g"), (_m, p: string, te: string) => `${p}${VALUE[te]}`);
  t = t.replace(new RegExp(word(`(${alt(UNITS)})`), "g"), (_m, p: string, u: string) => `${p}${VALUE[u]}`);
  return t;
}

type Unit = "day" | "week" | "month" | "year" | "hour";
const UNIT_RE: [RegExp, Unit][] = [
  [/^(يوم|أيام|ايام|يوما|يوماً)/, "day"], [/^(أسبوع|اسبوع|أسابيع)/, "week"], [/^(شهر|أشهر|اشهر|شهور|شهرا|شهراً)/, "month"],
  [/^(سنة|سنوات|سنين|عام|أعوام|اعوام)/, "year"], [/^(ساعة|ساعات)/, "hour"],
];
const DUALS: [RegExp, number, Unit][] = [
  [/(?<![؀-ۿ])[وبل]?(يومين|يومان)(?![؀-ۿ])/g, 2, "day"],
  [/(?<![؀-ۿ])[وبل]?(شهرين|شهران)(?![؀-ۿ])/g, 2, "month"],
  [/(?<![؀-ۿ])[وبل]?(سنتين|سنتان|عامين|عامان)(?![؀-ۿ])/g, 2, "year"],
  [/(?<![؀-ۿ])[وبل]?(ساعتين|ساعتان)(?![؀-ۿ])/g, 2, "hour"],
  [/(?<![؀-ۿ])[وبل]?(أسبوعين|اسبوعين)(?![؀-ۿ])/g, 2, "week"],
];

export interface Duration { value: number; unit: Unit; days: number }
const toDays = (v: number, u: Unit) => u === "day" ? v : u === "week" ? v * 7 : u === "month" ? v * 30 : u === "year" ? v * 365 : v / 24;

/** كل المدد المذكورة في جملة: «ستة أشهر» و«سنتين» و«90 يوماً». */
export function parseDurations(sentence: string): Duration[] {
  const t = wordsToNumbers(sentence);
  const out: Duration[] = [];
  for (const m of t.matchAll(/(\d+(?:[.,]\d+)?)\s*([؀-ۿ]+)/g)) {
    const u = UNIT_RE.find(([re]) => re.test(m[2]))?.[1];
    if (u) { const v = Number(m[1].replace(",", ".")); out.push({ value: v, unit: u, days: toDays(v, u) }); }
  }
  for (const [re, v, u] of DUALS) for (const _ of t.matchAll(re)) out.push({ value: v, unit: u, days: toDays(v, u) });
  // «سنة واحدة» (صارت «سنة 1») و«لمدة سنة»
  for (const m of t.matchAll(/(?<![\u0600-\u06FF])(سنة|عام|شهر|أسبوع|اسبوع|يوم)\s+1(?!\d)/g)) {
    const u = UNIT_RE.find(([re]) => re.test(m[1]))![1]; out.push({ value: 1, unit: u, days: toDays(1, u) });
  }
  for (const m of t.matchAll(/مد[ةه]\s+(سنة|عام|شهر|أسبوع|اسبوع)(?![\u0600-\u06FF])(?!\s+\d)/g)) {
    const u = UNIT_RE.find(([re]) => re.test(m[1]))![1]; out.push({ value: 1, unit: u, days: toDays(1, u) });
  }
  return out;
}

// ---------------------------------------------------------------- تقطيع النص
function sentences(text: string): string[] {
  return text.split(/(?<=[.!؟?؛;:])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}
const find = (ss: string[], re: RegExp) => ss.find((s) => re.test(s)) ?? null;
/** «10 ساعات» و«3 سنوات» و«12 ساعة» */
const plural = (n: number, few: string, many: string) => `${n} ${n >= 3 && n <= 10 ? few : many}`;
const clip = (s: string | null) => (s && s.length > 260 ? `${s.slice(0, 257)}…` : s);

const LABOR = "نظام العمل";
const PDPL = "نظام حماية البيانات الشخصية";

// ---------------------------------------------------------------- عقد العمل
function laborChecks(ss: string[], text: string, F: ContractFinding[], P: string[]) {
  // 1) فترة التجربة
  const prob = find(ss, /تجرب[ةه]/);
  if (prob) {
    const total = parseDurations(prob).filter((d) => d.unit !== "hour").reduce((a, d) => a + d.days, 0);
    if (total > 180) F.push({ id: "probation-max", severity: "VIOLATION", title: "فترة التجربة تتجاوز الحد النظامي", excerpt: clip(prob), law: `${LABOR} — المادة 53`,
      explanation: `مجموع فترة التجربة في العقد نحو ${Math.round(total)} يوماً، والنظام يحدّها بـ 90 يوماً يجوز تمديدها باتفاق مكتوب على ألا تتجاوز 180 يوماً.`,
      suggestion: "يخضع العامل لفترة تجربة مدتها تسعون يوماً، ويجوز باتفاق مكتوب بين الطرفين تمديدها على ألا يزيد مجموعها على مائة وثمانين يوماً، ولا تدخل فيها إجازتا عيدي الفطر والأضحى والإجازة المرضية." });
    else if (total > 90 && !/تمديد|يمدد|تمدد|باتفاق/.test(prob)) F.push({ id: "probation-ext", severity: "WARNING", title: "فترة تجربة أطول من 90 يوماً دون نص على التمديد", excerpt: clip(prob), law: `${LABOR} — المادة 53`,
      explanation: "الأصل 90 يوماً، والزيادة حتى 180 يوماً تكون تمديداً باتفاق مكتوب. اذكر صراحة أن المدة الزائدة تمديد متفق عليه.",
      suggestion: "مدة التجربة تسعون يوماً، وقد اتفق الطرفان كتابةً على تمديدها ثلاثين يوماً إضافية." });
    else P.push("فترة التجربة ضمن الحد النظامي");
  } else P.push("لا ينص العقد على فترة تجربة");

  // 2) ساعات العمل
  const hrs = ss.filter((s) => /ساع/.test(s) && /عمل|دوام/.test(s) && !/إضافي|اضافي/.test(s));
  let hoursBad = false;
  for (const s of hrs) {
    // كل رقم ساعات يُقرأ مع ما بعده مباشرة: «48 ساعة أسبوعياً» حد أسبوعي، وغيره حد يومي
    const over = [...wordsToNumbers(s).matchAll(/(\d+)\s*(?:ساعة|ساعات)([^.\d،]{0,20})/g)]
      .map((m) => ({ max: Number(m[1]), weekly: /أسبوع|اسبوع/.test(m[2]) }))
      .find((x) => x.max > (x.weekly ? 48 : 8));
    if (over) {
      const { max, weekly } = over;
      hoursBad = true;
      F.push({ id: "hours", severity: "VIOLATION", title: "ساعات العمل تتجاوز الحد النظامي", excerpt: clip(s), law: `${LABOR} — المادة 98`,
        explanation: `ساعات العمل المذكورة ${plural(max, "ساعات", "ساعة")} ${weekly ? "أسبوعياً" : "يومياً"}، والحد ثماني ساعات يومياً أو ثمان وأربعون ساعة أسبوعياً، وتخفض في رمضان للمسلمين.`,
        suggestion: "ساعات العمل ثماني ساعات يومياً بحد أقصى ثمان وأربعين ساعة أسبوعياً، وما زاد عليها يُعد عملاً إضافياً بأجر إضافي." });
      break;
    }
  }
  if (!hoursBad) P.push(hrs.length ? "ساعات العمل ضمن الحد النظامي" : "لا تحديد مخالف لساعات العمل");

  // 3) العمل الإضافي
  const ot = find(ss, /(عمل|ساعات)\s*(ال)?إضافي|(عمل|ساعات)\s*(ال)?اضافي/);
  if (ot && /دون|بدون|بلا|لا يستحق|مشمول|ضمن الراتب|لا يحق/.test(ot))
    F.push({ id: "overtime", severity: "VIOLATION", title: "العمل الإضافي دون أجر نظامي", excerpt: clip(ot), law: `${LABOR} — المادة 107`,
      explanation: "يستحق العامل عن كل ساعة عمل إضافية أجر الساعة مضافاً إليه 50% من أجره الأساسي، ولا يصح الاتفاق على إسقاطه.",
      suggestion: "يستحق العامل عن ساعات العمل الإضافية أجراً يوازي أجر الساعة مضافاً إليه خمسون بالمائة من أجره الأساسي." });
  else P.push("العمل الإضافي");

  // 4) الإجازة السنوية
  const lv = find(ss, /إجاز[ةه]\s*سنوي|اجاز[ةه]\s*سنوي/);
  if (!lv) F.push({ id: "leave-missing", severity: "WARNING", title: "العقد لا يذكر الإجازة السنوية", excerpt: null, law: `${LABOR} — المادة 109`,
    explanation: "الإجازة السنوية حق نظامي لا يقل عن 21 يوماً، ويزيد إلى 30 يوماً بعد خمس سنوات متصلة. يُستحسن النص عليها صراحة.",
    suggestion: "يستحق العامل إجازة سنوية بأجر كامل مدتها واحد وعشرون يوماً، تزاد إلى ثلاثين يوماً إذا أمضى خمس سنوات متصلة." });
  else {
    const d = parseDurations(lv).filter((x) => x.unit === "day").map((x) => x.value);
    if (d.length && Math.min(...d) < 21) F.push({ id: "leave", severity: "VIOLATION", title: "الإجازة السنوية أقل من الحد الأدنى", excerpt: clip(lv), law: `${LABOR} — المادة 109`,
      explanation: `الإجازة المذكورة ${Math.min(...d)} يوماً، والحد الأدنى 21 يوماً بأجر كامل.`,
      suggestion: "يستحق العامل إجازة سنوية بأجر كامل مدتها واحد وعشرون يوماً، تزاد إلى ثلاثين يوماً إذا أمضى خمس سنوات متصلة." });
    else P.push("الإجازة السنوية");
  }

  // 5) عدم المنافسة
  const nc = find(ss, /منافس/);
  if (nc) {
    const years = Math.max(0, ...parseDurations(nc).filter((d) => d.unit !== "hour").map((d) => d.days / 365));
    if (years > 2) F.push({ id: "noncompete-time", severity: "VIOLATION", title: "مدة عدم المنافسة تتجاوز سنتين", excerpt: clip(nc), law: `${LABOR} — المادة 83`,
      explanation: `المدة المذكورة ${Number.isInteger(years) ? plural(years, "سنوات", "سنة") : `نحو ${Math.round(years * 10) / 10} سنة`}، والنظام يشترط ألا تزيد على سنتين من تاريخ انتهاء العلاقة، وأن تكون محددة زماناً ومكاناً ونوع عمل.`,
      suggestion: "يلتزم العامل بعد انتهاء العقد ولمدة سنة واحدة بعدم العمل لدى منافس مباشر في مجال [نوع النشاط] داخل مدينة [المدينة]، ولا يتجاوز ذلك ما يلزم لحماية مصالح صاحب العمل المشروعة." });
    else if (!years) F.push({ id: "noncompete-nodur", severity: "WARNING", title: "شرط عدم منافسة دون مدة محددة", excerpt: clip(nc), law: `${LABOR} — المادة 83`,
      explanation: "شرط عدم المنافسة يجب أن يكون مكتوباً ومحدداً بالزمان (سنتان حداً أقصى) والمكان ونوع العمل، وإلا كان عرضة للبطلان.",
      suggestion: "يلتزم العامل بعد انتهاء العقد ولمدة سنة واحدة بعدم العمل لدى منافس مباشر في مجال [نوع النشاط] داخل مدينة [المدينة]." });
    if (/جميع|كافة|أي مكان|اي مكان|العالم|أي دولة|دول مجلس|الخليج/.test(nc)) F.push({ id: "noncompete-scope", severity: "WARNING", title: "نطاق مكاني واسع لعدم المنافسة", excerpt: clip(nc), law: `${LABOR} — المادة 83`,
      explanation: "النطاق المكاني يجب أن يقتصر على ما يلزم لحماية مصالح صاحب العمل المشروعة؛ النطاق الإقليمي أو المفتوح عرضة للإبطال.",
      suggestion: "يقتصر الالتزام على مدينة [المدينة] وعلى الأنشطة المماثلة لنشاط صاحب العمل." });
    if (years > 0 && years <= 2 && !/جميع|كافة|أي مكان|اي مكان|العالم|أي دولة|دول مجلس|الخليج/.test(nc)) P.push("شرط عدم المنافسة محدد المدة والنطاق");
  } else P.push("لا يتضمن شرط عدم منافسة");

  // 6) التنازل عن مكافأة نهاية الخدمة أو أي حق نظامي
  const eos = find(ss, /نهاية\s*الخدمة/);
  if (eos && /يتنازل|تنازل|لا يستحق|يسقط|إسقاط|اسقاط|لا يحق/.test(eos))
    F.push({ id: "eos-waiver", severity: "VIOLATION", title: "إسقاط مكافأة نهاية الخدمة", excerpt: clip(eos), law: `${LABOR} — المادتان 8 و84`,
      explanation: "مكافأة نهاية الخدمة حق نظامي (نصف أجر شهر عن كل سنة من السنوات الخمس الأولى، وأجر شهر عن كل سنة بعدها)، وكل شرط يخالف النظام باطل ما لم يكن أفضل للعامل.",
      suggestion: "يستحق العامل عند انتهاء علاقة العمل مكافأة نهاية خدمة وفق أحكام نظام العمل." });
  else P.push("مكافأة نهاية الخدمة");

  // 7) احتجاز جواز السفر أو الوثائق
  const pp = find(ss, /جواز|وثائق\s*(ال)?عامل|الإقامة الأصلية/);
  if (pp && /يحتفظ|احتفاظ|الاحتفاظ|يسلم|تسليم|يحتجز|احتجاز|لدى صاحب العمل|لدى الشركة/.test(pp))
    F.push({ id: "passport", severity: "VIOLATION", title: "احتفاظ صاحب العمل بجواز سفر العامل", excerpt: clip(pp), law: "نظام العمل ولوائحه — حظر احتجاز وثائق العامل",
      explanation: "لا يجوز لصاحب العمل احتجاز جواز سفر العامل أو وثائقه الشخصية دون موافقته؛ ويُعد ذلك مخالفة تترتب عليها غرامات.",
      suggestion: "يحتفظ العامل بجواز سفره ووثائقه الشخصية، ولا يجوز لصاحب العمل احتجازها." });

  // 8) البيانات الأساسية في العقد
  const missing: string[] = [];
  if (!/أجر|راتب/.test(text)) missing.push("الأجر");
  if (!/مسمى|وظيف|مهن[ةه]|نوع العمل/.test(text)) missing.push("نوع العمل أو المسمى");
  if (!/مد[ةه]\s*العقد|غير محدد المد[ةه]|محدد المد[ةه]/.test(text)) missing.push("مدة العقد");
  if (!/مقر|مكان العمل|مدين[ةه]/.test(text)) missing.push("مكان العمل");
  if (missing.length) F.push({ id: "essentials", severity: "WARNING", title: "بيانات أساسية غير مذكورة", excerpt: null, law: `${LABOR} — المادة 52`,
    explanation: `يجب أن يتضمن عقد العمل بياناته الأساسية، ولم يُعثر في النص على: ${missing.join("، ")}.`, suggestion: null });
  else P.push("البيانات الأساسية (الأجر، نوع العمل، المدة، المكان)");
}

// ---------------------------------------------------------------- سياسة الخصوصية
function privacyChecks(ss: string[], text: string, F: ContractFinding[], P: string[]) {
  const need: [string, RegExp, string, string][] = [
    ["purpose", /الغرض|أغراض|اغراض|نستخدم بياناتك ل|لغرض/, "الغرض من جمع البيانات", "اذكر الغرض الصريح والمحدد من جمع كل فئة من البيانات."],
    ["data", /البيانات التي نجمع|نجمع\s|نقوم بجمع|المعلومات التي نجمع/, "البيانات التي تُجمع", "عدّد فئات البيانات الشخصية التي تُجمع."],
    ["retention", /نحتفظ|الاحتفاظ|مد[ةه]\s*(ال)?حفظ|نتلف|إتلاف|اتلاف/, "مدة الحفظ والإتلاف", "اذكر مدة الاحتفاظ بالبيانات وطريقة إتلافها بعد انتهاء الغرض."],
    ["rights", /حق(ك)?\s*(في\s*)?(ال)?(وصول|اطلاع|الاطلاع|تصحيح|إتلاف|اتلاف|حذف)|حقوقك/, "حقوق صاحب البيانات", "بيّن حقوق صاحب البيانات: العلم، والوصول، والتصحيح، والإتلاف، وطريقة ممارستها."],
    ["contact", /تواصل|للتواصل|راسلنا|@|البريد الإلكتروني|البريد الالكتروني/, "وسيلة التواصل لممارسة الحقوق", "اذكر وسيلة تواصل محددة لاستقبال طلبات أصحاب البيانات."],
  ];
  const lacking: string[] = [];
  for (const [, re, label] of need) (re.test(text) ? P : lacking).push(label);
  if (lacking.length) F.push({ id: "privacy-required", severity: lacking.length >= 3 ? "VIOLATION" : "WARNING",
    title: `عناصر إلزامية ناقصة في سياسة الخصوصية (${lacking.length})`, excerpt: null, law: `${PDPL} — المادة 12`,
    explanation: `يجب أن تتضمن سياسة الخصوصية المعلنة قبل الجمع عناصر محددة، ولم يُعثر في النص على: ${lacking.join("، ")}.`,
    suggestion: need.filter(([, , l]) => lacking.includes(l)).map(([, , , s]) => s).join(" ") });

  const sell = find(ss, /نبيع|بيع\s*(ال)?بيانات|بيع\s*معلومات/);
  if (sell && !/لا نبيع|لن نبيع|لا تبيع/.test(sell)) F.push({ id: "sell", severity: "VIOLATION", title: "بيع البيانات الشخصية", excerpt: clip(sell), law: `${PDPL} — المادتان 5 و15`,
    explanation: "الإفصاح عن البيانات الشخصية لغير الغرض الذي جُمعت له يتطلب موافقة صاحبها ضمن حالات محددة، وبيعها يتعارض مع قصر المعالجة على الغرض.",
    suggestion: "لا نبيع بياناتك الشخصية، ولا نفصح عنها لأي طرف إلا في الحالات التي يجيزها النظام." });

  const noConsent = find(ss, /دون\s*(أخذ\s*)?موافقت|بدون\s*موافق|من غير موافق/);
  if (noConsent) F.push({ id: "consent", severity: "VIOLATION", title: "معالجة دون موافقة صاحب البيانات", excerpt: clip(noConsent), law: `${PDPL} — المادة 5`,
    explanation: "الأصل ألا تُعالج البيانات الشخصية أو يُغيّر غرض معالجتها إلا بموافقة صاحبها، عدا الحالات المستثناة نظاماً.",
    suggestion: "نعالج بياناتك بناءً على موافقتك أو على أساس نظامي آخر نحدده لكل غرض، ويحق لك الرجوع عن موافقتك في أي وقت." });

  const share = find(ss, /أطراف\s*ثالث|اطراف\s*ثالث|شركائنا|نشارك/);
  if (share && !/(?:لا|لن)\s*نشارك/.test(share) && !/الغرض|متعاقد|اتفاقي|التزام/.test(share))
    F.push({ id: "sharing", severity: "WARNING", title: "مشاركة مع أطراف ثالثة دون ضوابط", excerpt: clip(share), law: `${PDPL} — المادة 15`,
      explanation: "حدد الجهات أو فئاتها، والغرض من المشاركة، والتزامها التعاقدي بحماية البيانات.",
      suggestion: "قد نشارك بياناتك مع مزوّدي خدمات متعاقدين معنا لغرض [الغرض] فقط، ويلتزمون تعاقدياً بحمايتها وعدم استخدامها لغير ذلك." });
  else if (share) P.push("مشاركة البيانات مع أطراف ثالثة");

  const abroad = find(ss, /خارج\s*(ال)?مملك|خوادم\s*(في|ب)\s*(?!المملكة)|دولة أخرى|الخارج/);
  if (abroad && !/لا ننقل|لن ننقل|داخل المملكة/.test(abroad)) F.push({ id: "transfer", severity: "WARNING", title: "نقل البيانات خارج المملكة", excerpt: clip(abroad), law: `${PDPL} — المادة 29`,
    explanation: "النقل خارج المملكة مقيد بضوابط ولائحة خاصة؛ اذكر الوجهة والأساس النظامي للنقل والضمانات المتخذة.",
    suggestion: "تُخزَّن بياناتك داخل المملكة، وإن لزم نقل بعضها إلى [الدولة] لغرض [الغرض] فيكون وفق ضوابط النقل المعتمدة نظاماً." });
  else P.push("موقع تخزين البيانات");
}

// ---------------------------------------------------------------- الفحص
export function checkContract(text: string, kind: ContractKind): ContractCheckResult {
  const red = redactPii(text);
  const ss = sentences(red.text);
  const findings: ContractFinding[] = [];
  const passed: string[] = [];
  if (kind === "LABOR_CONTRACT") laborChecks(ss, red.text, findings, passed);
  else privacyChecks(ss, red.text, findings, passed);
  findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "VIOLATION" ? -1 : 1));
  const v = findings.filter((f) => f.severity === "VIOLATION").length;
  const w = findings.length - v;
  const percentage = Math.max(0, Math.min(100, 100 - v * 12 - w * 4));
  const verdict: ContractVerdict = v >= 3 || percentage < 50 ? "HIGH_RISK" : v > 0 ? "CONTAINS_VIOLATIONS" : "COMPLIANT";
  return { kind, verdict, percentage, findings, passed, redaction: { text: red.text, counts: red.counts } };
}

/** يخمّن نوع الوثيقة من نصها (يمكن للمستخدم تغييره). */
export function guessContractKind(text: string): ContractKind {
  return /سياس[ةه]\s*(ال)?خصوصي|بياناتك|ملفات تعريف الارتباط/.test(text) && !/العامل|صاحب العمل/.test(text) ? "PRIVACY_POLICY" : "LABOR_CONTRACT";
}

// ---------------------------------------------------------------- أمثلة تجريبية (بيانات وهمية)
export const SAMPLE_CONTRACTS: { id: string; title: string; kind: ContractKind; text: string }[] = [
  {
    id: "labor-bad", title: "عقد عمل فيه مخالفات شائعة", kind: "LABOR_CONTRACT",
    text: `عقد عمل محدد المدة
الطرف الأول: مؤسسة النخبة للمقاولات، ويمثلها مديرها العام.
الطرف الثاني: سالم عبدالله (اسم وهمي)، هوية وطنية رقم 1098765432، جوال 0551234567، الحساب البنكي SA03 8000 0000 6080 1016 7519.
البند الأول: يعمل الطرف الثاني بوظيفة مهندس موقع في مدينة الرياض، ومدة العقد سنة واحدة تبدأ من تاريخ المباشرة.
البند الثاني: الأجر الشهري 9,000 ريال يُصرف في نهاية كل شهر ميلادي.
البند الثالث: يخضع الطرف الثاني لفترة تجربة مدتها ستة أشهر قابلة للتمديد ثلاثة أشهر أخرى بقرار من الطرف الأول.
البند الرابع: ساعات العمل عشر ساعات يومياً لمدة ستة أيام في الأسبوع.
البند الخامس: يكلف الطرف الثاني بالعمل الإضافي عند الحاجة دون أجر إضافي لأن الراتب يشمله.
البند السادس: يستحق الطرف الثاني إجازة سنوية مدتها خمسة عشر يوماً.
البند السابع: يحتفظ الطرف الأول بجواز سفر الطرف الثاني طوال مدة العقد.
البند الثامن: يلتزم الطرف الثاني بعدم العمل لدى أي منافس لمدة ثلاث سنوات بعد انتهاء العقد في جميع دول مجلس التعاون.
البند التاسع: يتنازل الطرف الثاني عن مكافأة نهاية الخدمة إذا ترك العمل قبل انتهاء العقد.`,
  },
  {
    id: "labor-good", title: "عقد عمل متوافق", kind: "LABOR_CONTRACT",
    text: `عقد عمل غير محدد المدة
الطرف الأول: شركة واحة التقنية.
الطرف الثاني: نورة سعد (اسم وهمي)، هوية وطنية رقم 1012345678، البريد noura@example.com.
البند الأول: تعمل الطرف الثاني بوظيفة محللة بيانات، ومقر العمل مدينة جدة.
البند الثاني: الأجر الأساسي 12,000 ريال شهرياً، وبدل سكن 3,000 ريال.
البند الثالث: تخضع الطرف الثاني لفترة تجربة مدتها تسعون يوماً، ويجوز تمديدها باتفاق مكتوب بحيث لا يتجاوز مجموعها مائة وثمانين يوماً.
البند الرابع: ساعات العمل ثماني ساعات يومياً بحد أقصى ثمان وأربعين ساعة أسبوعياً.
البند الخامس: تستحق الطرف الثاني عن العمل الإضافي أجر الساعة مضافاً إليه خمسون بالمائة من الأجر الأساسي.
البند السادس: تستحق الطرف الثاني إجازة سنوية مدتها واحد وعشرون يوماً تزاد إلى ثلاثين يوماً بعد خمس سنوات متصلة.
البند السابع: تلتزم الطرف الثاني بعدم العمل لدى منافس مباشر في تحليل البيانات داخل مدينة جدة لمدة سنة واحدة بعد انتهاء العقد.
البند الثامن: تستحق الطرف الثاني مكافأة نهاية الخدمة وفق نظام العمل.`,
  },
  {
    id: "privacy-weak", title: "سياسة خصوصية ناقصة", kind: "PRIVACY_POLICY",
    text: `سياسة الخصوصية لمتجر الأفق الإلكتروني
نقوم بجمع اسمك ورقم جوالك وعنوانك وسجل مشترياتك عند استخدامك للمتجر.
قد نشارك بياناتك مع شركائنا التسويقيين.
تُخزَّن البيانات على خوادم في دولة أخرى لتحسين الأداء.
يحق لنا استخدام بياناتك لأغراض تسويقية دون موافقتك المسبقة.
باستخدامك للموقع فإنك توافق على هذه السياسة.`,
  },
];
