"""تقييم الأثر على حماية البيانات الشخصية (DPIA) — استبيان ثابت الإصدار ومنطق تقييم نقي.

كل سؤال «نعم» يضيف وزن خطورته. الدرجة = مجموع الأوزان ÷ مجموع الأوزان الممكنة × 100.
بعض الأسئلة «مُلزِمة»: إن كانت إجابتها نعم فالتقييم مطلوب نظاماً قبل بدء المعالجة.
لكل عامل خطر معالجة مقترحة؛ الخطر المتبقي يُخفَّض بنسبة المعالجات المنفذة لعوامله فقط.
"""

from __future__ import annotations

from dataclasses import dataclass

VERSION = "1.0"

# (key, section, question, weight, mandatory_trigger, mitigation)
QUESTIONS: list[dict] = [
    dict(key="sensitive", section="طبيعة البيانات", weight=15, trigger=True,
         q="هل تشمل المعالجة بيانات حساسة (صحية، وراثية، ائتمانية، دينية، أمنية، أو بيانات القُصّر)؟",
         mitigation="قصر الوصول على أشخاص محددين بالاسم، وتشفير البيانات الحساسة أثناء التخزين والنقل، وتوثيق الأساس النظامي الخاص بها."),
    dict(key="large_scale", section="طبيعة البيانات", weight=10, trigger=True,
         q="هل تتم المعالجة على نطاق واسع (عدد كبير من أصحاب البيانات أو حجم بيانات كبير أو نطاق جغرافي واسع)؟",
         mitigation="تقليل البيانات إلى الحد الأدنى اللازم، وتطبيق الترميز أو إخفاء الهوية حيث يمكن، وتحديد مدة احتفاظ قصيرة."),
    dict(key="children", section="طبيعة البيانات", weight=10, trigger=True,
         q="هل تتعلق المعالجة بأطفال أو بفئات ضعيفة (مرضى، كبار سن، موظفون في علاقة تبعية)؟",
         mitigation="الحصول على موافقة الولي حيث يلزم، وصياغة إشعار خصوصية مبسط، ومراجعة إضافية من مسؤول حماية البيانات."),
    dict(key="monitoring", section="طريقة المعالجة", weight=12, trigger=True,
         q="هل تتضمن المعالجة مراقبة منهجية لأصحاب البيانات (كاميرات، تتبع موقع، مراقبة سلوك أو أجهزة)؟",
         mitigation="إشعار واضح بالمراقبة، وحصرها في الغرض المعلن، ومدة احتفاظ محددة، وسجل للاطلاع على التسجيلات."),
    dict(key="automated", section="طريقة المعالجة", weight=12, trigger=True,
         q="هل تُتخذ قرارات آلية بالكامل تؤثر على أصحاب البيانات (قبول، رفض، تسعير، تقييم أداء)؟",
         mitigation="إتاحة مراجعة بشرية للقرار، وشرح منطق القرار لصاحب البيانات، واختبار النموذج دورياً للتحيز."),
    dict(key="new_tech", section="طريقة المعالجة", weight=8, trigger=False,
         q="هل تستخدم المعالجة تقنية جديدة أو ناشئة (ذكاء اصطناعي، قياسات حيوية، إنترنت الأشياء)؟",
         mitigation="تقييم المزوّد تقنياً وأمنياً، وتجربة محدودة قبل التعميم، وتوثيق ضوابط الخصوصية في التصميم."),
    dict(key="combining", section="طريقة المعالجة", weight=8, trigger=False,
         q="هل تُدمج أو تُطابق مجموعات بيانات من مصادر مختلفة لأغراض لم يُبلَّغ بها أصحاب البيانات؟",
         mitigation="التحقق من توافق الغرض الجديد مع الغرض الأصلي، وتحديث إشعار الخصوصية، أو الحصول على موافقة جديدة."),
    dict(key="secondary_use", section="الغرض والأساس", weight=6, trigger=False,
         q="هل ستُستخدم البيانات لغرض غير الغرض الذي جُمعت من أجله؟",
         mitigation="توثيق تحليل توافق الغرض، وإبلاغ أصحاب البيانات، والحصول على موافقة عند عدم التوافق."),
    dict(key="consent_basis", section="الغرض والأساس", weight=5, trigger=False,
         q="هل تعتمد المعالجة على الموافقة دون آلية موثقة لجمعها وسحبها؟",
         mitigation="اعتماد نموذج موافقة منفصل وواضح، وحفظ دليل الموافقة، وإتاحة سحبها بسهولة مماثلة لمنحها."),
    dict(key="cross_border", section="المشاركة والنقل", weight=12, trigger=True,
         q="هل تُنقل البيانات أو يُتاح الوصول إليها من خارج المملكة؟",
         mitigation="التحقق من وجود أساس نظامي للنقل وفق لائحة نقل البيانات خارج المملكة، وتوقيع بنود تعاقدية قياسية، وتوثيق تقييم مخاطر النقل."),
    dict(key="processors", section="المشاركة والنقل", weight=6, trigger=False,
         q="هل يعالج البيانات طرف ثالث (مزود سحابي، شركة رواتب، مركز اتصال) نيابة عن المنشأة؟",
         mitigation="توقيع اتفاقية معالجة بيانات، وتقييم المعالج قبل التعاقد، وحق التدقيق، والإشعار بالحوادث خلال 24 ساعة."),
    dict(key="sharing", section="المشاركة والنقل", weight=5, trigger=False,
         q="هل تُشارك البيانات مع جهات أخرى لأغراضها الخاصة (شركاء، معلنين)؟",
         mitigation="حصر المشاركة في ما يجيزه النظام، وتوثيقها في سجل المعالجة، وإبلاغ أصحاب البيانات بها."),
    dict(key="long_retention", section="الأمن والاحتفاظ", weight=4, trigger=False,
         q="هل تزيد مدة الاحتفاظ على ما يتطلبه الغرض أو النظام، أو لا توجد مدة محددة؟",
         mitigation="تحديد مدة احتفاظ لكل فئة بيانات في جدول الاحتفاظ، وإتلاف آمن موثق عند انتهائها."),
    dict(key="weak_security", section="الأمن والاحتفاظ", weight=10, trigger=False,
         q="هل تفتقر المعالجة لأي من: التشفير، التحقق الثنائي، سجلات الوصول، النسخ الاحتياطي؟",
         mitigation="تطبيق التشفير والتحقق الثنائي وسجلات الوصول والنسخ الاحتياطي المختبر وفق سياسة أمن المعلومات."),
    dict(key="subject_rights", section="الأمن والاحتفاظ", weight=5, trigger=False,
         q="هل يصعب على المنشأة تلبية حقوق أصحاب البيانات (الوصول، التصحيح، الإتلاف) في هذا النشاط؟",
         mitigation="توثيق مسار لتنفيذ كل حق خلال 30 يوماً، وتحديد مسؤول، واختبار المسار قبل التشغيل."),
]

KEYS = [q["key"] for q in QUESTIONS]
MAX_SCORE = sum(q["weight"] for q in QUESTIONS)
LEVEL_LABEL = {"LOW": "منخفض", "MEDIUM": "متوسط", "HIGH": "عالٍ", "CRITICAL": "حرج"}


def level_for(score: int) -> str:
    if score >= 60:
        return "CRITICAL"
    if score >= 40:
        return "HIGH"
    if score >= 20:
        return "MEDIUM"
    return "LOW"


@dataclass(frozen=True)
class Assessment:
    score: int
    level: str
    required: bool
    triggers: list[str]
    residual_score: int
    residual_level: str
    open_mitigations: int

    def as_dict(self) -> dict:
        return dict(self.__dict__)


def suggested_mitigations(answers: dict[str, bool]) -> list[dict]:
    return [{"code": q["key"], "text": q["mitigation"], "status": "PLANNED", "owner": None}
            for q in QUESTIONS if answers.get(q["key"])]


def assess(answers: dict[str, bool], mitigations: list[dict] | None = None) -> Assessment:
    unknown = set(answers) - set(KEYS)
    if unknown:
        raise ValueError(f"أسئلة غير معروفة: {', '.join(sorted(unknown))}")
    yes = [q for q in QUESTIONS if answers.get(q["key"])]
    raw = sum(q["weight"] for q in yes)
    score = round(raw * 100 / MAX_SCORE)
    mits = mitigations or []
    done = {m["code"] for m in mits if m.get("status") == "DONE"}
    pending = {m["code"] for m in mits if m.get("status") != "DONE"}
    # عامل الخطر الذي نُفِّذت كل معالجاته (ولا معالجة معلقة له) يُخفَّض وزنه إلى الثلث
    reduced = sum(q["weight"] * 2 / 3 for q in yes if q["key"] in done and q["key"] not in pending)
    residual = round((raw - reduced) * 100 / MAX_SCORE)
    triggers = [q["key"] for q in yes if q["trigger"]]
    return Assessment(score, level_for(score), bool(triggers), triggers, residual, level_for(residual),
                      sum(1 for m in mits if m.get("status") != "DONE"))
