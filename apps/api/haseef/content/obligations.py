"""كتالوج الالتزامات النظامية والسياسات المطلوبة، مع قواعد الانطباق.

قواعد الانطباق (applies):
  legal_types       قائمة الكيانات (فارغة = الكل)
  min_employees     يُطبَّق إن كان عدد الموظفين ≥ القيمة (غير معروف = يُطبَّق مع التنبيه)
  personal_data     يُطبَّق فقط إن كانت المنشأة تعالج بيانات شخصية
  vat               يُطبَّق فقط إن كانت المنشأة مسجلة (أو ملزمة بالتسجيل) في ضريبة القيمة المضافة
  industries        كلمات تُطابق قطاع المنشأة (لأنشطة خاصة مثل مكافحة غسل الأموال)

كل العناصر تبدأ "مسودة — قيد المراجعة". المراجع على مستوى النظام/الجهة، لا أرقام مواد.
"""

from __future__ import annotations

from .standards import COMPANIES, COMPANIES_LAW, JSC, MC_URL, PDPL, PDPL_URL

LABOR_LAW = "نظام العمل ولائحته التنفيذية — وزارة الموارد البشرية والتنمية الاجتماعية"
HRSD_URL = "https://www.hrsd.gov.sa"
ZATCA_URL = "https://zatca.gov.sa"

OBLIGATIONS: list[dict] = [
    # ---------------- تجاري
    dict(code="CR_ANNUAL_CONFIRMATION", kind="LICENSE", domain="COMMERCIAL", frequency="ANNUAL", risk="CRITICAL",
         category="COMMERCIAL_REG", title="السجل التجاري — تأكيد البيانات السنوي",
         description="الحفاظ على سريان السجل التجاري وتأكيد بياناته سنوياً عبر منصة وزارة التجارة، وتحديثها عند أي تغيير.",
         authority="وزارة التجارة", reference="نظام السجل التجاري", url=MC_URL, applies={}, sort=10),
    dict(code="CHAMBER_MEMBERSHIP", kind="LICENSE", domain="COMMERCIAL", frequency="RENEWAL", risk="MEDIUM",
         category="CHAMBER", title="عضوية الغرفة التجارية",
         description="الاشتراك في الغرفة التجارية المختصة وتجديده عند الاستحقاق.",
         authority="الغرفة التجارية", reference="نظام الغرف التجارية", url=None, applies={}, sort=20),
    dict(code="UBO_DISCLOSURE", kind="REGISTRATION", domain="GOVERNANCE", frequency="EVENT", risk="HIGH",
         category=None, title="الإفصاح عن المستفيد الحقيقي",
         description="الإفصاح عن بيانات المستفيد الحقيقي لوزارة التجارة وتحديثها خلال المدة المحددة عند أي تغيير في الملكية أو السيطرة.",
         authority="وزارة التجارة", reference="متطلبات وزارة التجارة للإفصاح عن المستفيد الحقيقي", url=MC_URL,
         applies={"legal_types": COMPANIES}, sort=30),
    dict(code="FS_DEPOSIT", kind="FILING", domain="GOVERNANCE", frequency="ANNUAL", risk="HIGH",
         category=None, title="إيداع القوائم المالية السنوية",
         description="إعداد القوائم المالية السنوية (مراجعة عند لزوم المراجع) وإيداعها عبر منصة وزارة التجارة في المدة النظامية.",
         authority="وزارة التجارة", reference=COMPANIES_LAW, url=MC_URL,
         applies={"legal_types": [*COMPANIES, "BRANCH_OF_FOREIGN"]}, sort=40),
    dict(code="BYLAWS_ALIGNMENT", kind="PRACTICE", domain="GOVERNANCE", frequency="EVENT", risk="HIGH",
         category=None, title="توافق عقد التأسيس / النظام الأساس مع نظام الشركات",
         description="مراجعة عقد التأسيس أو النظام الأساس وتعديله بما يتوافق مع أحكام نظام الشركات، وتحديثه عند أي تغيير.",
         authority="وزارة التجارة", reference=COMPANIES_LAW, url=MC_URL,
         applies={"legal_types": COMPANIES}, sort=50),

    # ---------------- بلدي وسلامة
    dict(code="BALADY_LICENSE", kind="LICENSE", domain="MUNICIPAL", frequency="RENEWAL", risk="CRITICAL",
         category="BALADY", title="رخصة النشاط التجاري (بلدي)",
         description="رخصة البلدية لكل موقع تمارس فيه المنشأة نشاطاً، وتجديدها قبل انتهائها.",
         authority="وزارة البلديات والإسكان — منصة بلدي", reference="نظام الرخص البلدية",
         url="https://balady.gov.sa", applies={}, sort=100),
    dict(code="CIVIL_DEFENSE_CERT", kind="LICENSE", domain="SAFETY", frequency="RENEWAL", risk="HIGH",
         category="CIVIL_DEFENSE", title="شهادة السلامة من الدفاع المدني (سلامة)",
         description="استيفاء اشتراطات السلامة والوقاية من الحريق للموقع والحصول على الشهادة وتجديدها.",
         authority="المديرية العامة للدفاع المدني", reference="نظام الدفاع المدني واشتراطات السلامة",
         url="https://salamah.998.gov.sa", applies={}, sort=110),

    # ---------------- العمل
    dict(code="GOSI_REGISTRATION", kind="REGISTRATION", domain="LABOR", frequency="CONTINUOUS", risk="HIGH",
         category="GOSI", title="تسجيل العاملين في التأمينات الاجتماعية",
         description="تسجيل جميع العاملين وسداد الاشتراكات الشهرية في مواعيدها وتحديث الأجور.",
         authority="المؤسسة العامة للتأمينات الاجتماعية", reference="نظام التأمينات الاجتماعية",
         url="https://www.gosi.gov.sa", applies={"min_employees": 1}, sort=200),
    dict(code="QIWA_CONTRACTS", kind="PRACTICE", domain="LABOR", frequency="CONTINUOUS", risk="MEDIUM",
         category=None, title="توثيق عقود العمل إلكترونياً",
         description="توثيق عقود العمل لجميع العاملين عبر منصة قوى وتحديثها عند أي تعديل.",
         authority="وزارة الموارد البشرية — منصة قوى", reference=LABOR_LAW, url="https://qiwa.sa",
         applies={"min_employees": 1}, sort=210),
    dict(code="WAGE_PROTECTION", kind="PRACTICE", domain="LABOR", frequency="CONTINUOUS", risk="HIGH",
         category="WPS", title="نظام حماية الأجور",
         description="صرف الأجور عبر القنوات البنكية ورفع ملف حماية الأجور شهرياً في الموعد.",
         authority="وزارة الموارد البشرية — منصة مدد", reference=LABOR_LAW, url=HRSD_URL,
         applies={"min_employees": 1}, sort=220),
    dict(code="NITAQAT", kind="PRACTICE", domain="LABOR", frequency="CONTINUOUS", risk="HIGH",
         category="QIWA_NITAQAT", title="نسب التوطين (نطاقات)",
         description="المحافظة على نسبة التوطين المطلوبة لنشاط المنشأة وحجمها ومتابعة النطاق بانتظام.",
         authority="وزارة الموارد البشرية", reference="برنامج نطاقات", url="https://qiwa.sa",
         applies={"min_employees": 1}, sort=230),
    dict(code="WORK_REGULATION", kind="POLICY", domain="LABOR", frequency="ONCE", risk="MEDIUM",
         category=None, policy_type="WORK_REGULATION", title="لائحة تنظيم العمل",
         description="اعتماد لائحة تنظيم العمل (النموذج الموحد أو لائحة خاصة معتمدة) وإعلانها للعاملين.",
         authority="وزارة الموارد البشرية", reference=LABOR_LAW, url=HRSD_URL,
         applies={"min_employees": 10}, sort=240),
    dict(code="HEALTH_INSURANCE", kind="LICENSE", domain="INSURANCE", frequency="RENEWAL", risk="HIGH",
         category="CHI_INSURANCE", title="التأمين الصحي التعاوني للعاملين",
         description="توفير وثيقة تأمين صحي للعاملين ومن يعولون وفق الأنظمة، وتجديدها قبل انتهائها.",
         authority="مجلس الضمان الصحي", reference="نظام الضمان الصحي التعاوني", url="https://www.chi.gov.sa",
         applies={"min_employees": 1}, sort=250),
    dict(code="OHS_POLICY", kind="POLICY", domain="SAFETY", frequency="ONCE", risk="MEDIUM",
         category=None, policy_type="HEALTH_SAFETY", title="سياسة السلامة والصحة المهنية",
         description="سياسة وإجراءات للسلامة والصحة المهنية في مواقع العمل وتدريب العاملين عليها.",
         authority="وزارة الموارد البشرية", reference=LABOR_LAW, url=HRSD_URL,
         applies={"min_employees": 1}, sort=260),

    # ---------------- الزكاة والضريبة
    dict(code="ZAKAT_RETURN", kind="FILING", domain="TAX", frequency="ANNUAL", risk="HIGH",
         category="ZATCA", title="إقرار الزكاة السنوي وشهادة الزكاة",
         description="تقديم إقرار الزكاة خلال المدة النظامية بعد نهاية السنة المالية وسداد المستحق للحصول على الشهادة.",
         authority="هيئة الزكاة والضريبة والجمارك", reference="اللائحة التنفيذية لجباية الزكاة", url=ZATCA_URL,
         applies={}, sort=300),
    dict(code="VAT_REGISTRATION", kind="REGISTRATION", domain="TAX", frequency="ONCE", risk="HIGH",
         category=None, title="التسجيل في ضريبة القيمة المضافة",
         description="التسجيل الإلزامي عند تجاوز حد التسجيل للإيرادات الخاضعة، وتحديث بيانات التسجيل.",
         authority="هيئة الزكاة والضريبة والجمارك", reference="نظام ضريبة القيمة المضافة ولائحته", url=ZATCA_URL,
         applies={"vat": True}, sort=310),
    dict(code="VAT_RETURNS", kind="FILING", domain="TAX", frequency="CONTINUOUS", risk="HIGH",
         category=None, title="إقرارات ضريبة القيمة المضافة",
         description="تقديم الإقرارات الضريبية الدورية (شهرية أو ربع سنوية) وسداد الضريبة في مواعيدها.",
         authority="هيئة الزكاة والضريبة والجمارك", reference="نظام ضريبة القيمة المضافة ولائحته", url=ZATCA_URL,
         applies={"vat": True}, sort=320),
    dict(code="E_INVOICING", kind="PRACTICE", domain="TAX", frequency="CONTINUOUS", risk="HIGH",
         category=None, title="الفوترة الإلكترونية (فاتورة)",
         description="إصدار الفواتير إلكترونياً وفق متطلبات الهيئة، والربط مع منصتها عند حلول موعد المرحلة الخاصة بالمنشأة.",
         authority="هيئة الزكاة والضريبة والجمارك", reference="لائحة الفوترة الإلكترونية", url=ZATCA_URL,
         applies={"vat": True}, sort=330),

    # ---------------- حماية البيانات الشخصية
    dict(code="PDPL_PRIVACY_POLICY", kind="POLICY", domain="PDPL", frequency="ONCE", risk="HIGH",
         category=None, policy_type="PRIVACY_POLICY", title="سياسة الخصوصية",
         description="سياسة خصوصية معلنة لأصحاب البيانات قبل جمع بياناتهم، تُراجع دورياً.",
         authority="الهيئة السعودية للبيانات والذكاء الاصطناعي (سدايا)", reference=PDPL, url=PDPL_URL,
         applies={"personal_data": True}, sort=400),
    dict(code="PDPL_ROPA", kind="PRACTICE", domain="PDPL", frequency="CONTINUOUS", risk="MEDIUM",
         category=None, title="سجل أنشطة المعالجة",
         description="توثيق أنشطة معالجة البيانات الشخصية وتحديث السجل عند إضافة نشاط جديد.",
         authority="سدايا", reference=PDPL, url=PDPL_URL, applies={"personal_data": True}, sort=410),
    dict(code="PDPL_BREACH", kind="POLICY", domain="PDPL", frequency="ONCE", risk="HIGH",
         category=None, policy_type="BREACH_RESPONSE", title="إجراء الاستجابة لتسرب البيانات",
         description="إجراء لاكتشاف الحوادث وتقييمها وإبلاغ الجهة المختصة خلال المدة النظامية وإشعار المتضررين.",
         authority="سدايا", reference=PDPL, url=PDPL_URL, applies={"personal_data": True}, sort=420),
    dict(code="PDPL_RETENTION", kind="POLICY", domain="PDPL", frequency="ONCE", risk="MEDIUM",
         category=None, policy_type="DATA_RETENTION", title="سياسة الاحتفاظ بالبيانات وإتلافها",
         description="تحديد مدد الاحتفاظ بكل فئة بيانات وآلية الإتلاف الآمن بعد انتهاء الغرض.",
         authority="سدايا", reference=PDPL, url=PDPL_URL, applies={"personal_data": True}, sort=430),
    dict(code="PDPL_SECURITY", kind="POLICY", domain="PDPL", frequency="ONCE", risk="MEDIUM",
         category=None, policy_type="INFOSEC", title="سياسة أمن المعلومات",
         description="ضوابط تنظيمية وتقنية لحماية البيانات من الوصول غير المصرح به أو الفقد أو التعديل.",
         authority="سدايا", reference=PDPL, url=PDPL_URL, applies={"personal_data": True}, sort=440),
    dict(code="PDPL_DPO", kind="PRACTICE", domain="PDPL", frequency="ONCE", risk="MEDIUM",
         category=None, title="مسؤول حماية البيانات الشخصية",
         description="تعيين مسؤول لحماية البيانات في الحالات التي تحددها القواعد الصادرة من سدايا، وتحديد مهامه.",
         authority="سدايا", reference=PDPL, url=PDPL_URL, applies={"personal_data": True}, sort=450),

    # ---------------- الحوكمة الداخلية
    dict(code="GOV_DOA", kind="POLICY", domain="GOVERNANCE", frequency="ONCE", risk="MEDIUM",
         category=None, policy_type="DOA", title="مصفوفة الصلاحيات",
         description="وثيقة معتمدة تحدد صلاحيات الاعتماد المالي والتعاقدي والتوظيف وحدودها.",
         authority=None, reference=COMPANIES_LAW, url=None, applies={"legal_types": COMPANIES}, sort=500),
    dict(code="GOV_CONFLICT_OF_INTEREST", kind="POLICY", domain="GOVERNANCE", frequency="ONCE", risk="MEDIUM",
         category=None, policy_type="CONFLICT_OF_INTEREST", title="سياسة تعارض المصالح",
         description="إلزام أعضاء المجلس والإدارة بالإفصاح عن المصالح وتنظيم التعامل معها.",
         authority=None, reference=COMPANIES_LAW, url=None, applies={"legal_types": COMPANIES}, sort=510),
    dict(code="GOV_RELATED_PARTIES", kind="POLICY", domain="GOVERNANCE", frequency="ONCE", risk="MEDIUM",
         category=None, policy_type="RELATED_PARTIES", title="سياسة تعاملات الأطراف ذات العلاقة",
         description="ضوابط الموافقة على التعاملات مع الأطراف ذات العلاقة والإفصاح عنها للجمعية.",
         authority=None, reference=COMPANIES_LAW, url=None, applies={"legal_types": JSC}, sort=520),
    dict(code="GOV_BOARD_CHARTER", kind="POLICY", domain="GOVERNANCE", frequency="ONCE", risk="MEDIUM",
         category=None, policy_type="BOARD_CHARTER", title="لائحة عمل مجلس الإدارة",
         description="تنظيم اختصاصات المجلس واجتماعاته ونصابه وآلية اتخاذ القرار.",
         authority=None, reference=COMPANIES_LAW, url=None, applies={"legal_types": JSC}, sort=530),
    dict(code="GOV_AUDIT_CHARTER", kind="POLICY", domain="GOVERNANCE", frequency="ONCE", risk="MEDIUM",
         category=None, policy_type="AUDIT_COMMITTEE_CHARTER", title="لائحة عمل لجنة المراجعة",
         description="مهام لجنة المراجعة وضوابط عملها ومكافآت أعضائها، تعتمدها الجمعية العامة.",
         authority=None, reference=COMPANIES_LAW, url=None, applies={"legal_types": JSC}, sort=540),
    dict(code="GOV_WHISTLEBLOWING", kind="POLICY", domain="GOVERNANCE", frequency="ONCE", risk="MEDIUM",
         category=None, policy_type="WHISTLEBLOWING", title="سياسة الإبلاغ عن المخالفات",
         description="قناة سرية للإبلاغ عن المخالفات وحماية المبلّغين.",
         authority=None, reference="لائحة حوكمة الشركات — هيئة السوق المالية", url=None,
         applies={"legal_types": JSC}, sort=550),
    dict(code="GOV_DISCLOSURE", kind="POLICY", domain="GOVERNANCE", frequency="ONCE", risk="HIGH",
         category=None, policy_type="DISCLOSURE", title="سياسة الإفصاح والشفافية",
         description="ضوابط الإفصاح عن المعلومات الجوهرية للسوق والمساهمين في مواعيدها.",
         authority="هيئة السوق المالية", reference="لائحة حوكمة الشركات وقواعد الإدراج",
         url="https://cma.org.sa", applies={"legal_types": ["PUBLIC_JOINT_STOCK"]}, sort=560),
    dict(code="GOV_CODE_OF_CONDUCT", kind="POLICY", domain="GOVERNANCE", frequency="ONCE", risk="MEDIUM",
         category=None, policy_type="CODE_OF_CONDUCT", title="ميثاق السلوك المهني",
         description="قيم المنشأة وقواعد السلوك المتوقعة من العاملين والإدارة.",
         authority=None, reference=None, url=None, applies={"min_employees": 10}, sort=570),

    # ---------------- مكافحة غسل الأموال (أنشطة محددة)
    dict(code="AML_PROGRAM", kind="POLICY", domain="AML", frequency="ONCE", risk="HIGH",
         category=None, policy_type="AML", title="برنامج مكافحة غسل الأموال وتمويل الإرهاب",
         description="للأعمال والمهن غير المالية المحددة (مثل العقار والمعادن الثمينة والمحاسبة والمحاماة): تقييم المخاطر، العناية الواجبة، الإبلاغ عن الاشتباه.",
         authority="وزارة التجارة / الجهة الرقابية للنشاط", reference="نظام مكافحة غسل الأموال ولائحته التنفيذية", url=MC_URL,
         applies={"industries": ["عقار", "ذهب", "مجوهرات", "معادن", "محاسب", "محاما", "قانون"]}, sort=600),

    # ---------------- العمل (إضافة 1.2)
    dict(code="ANTI_HARASSMENT_POLICY", kind="POLICY", domain="LABOR", frequency="CONTINUOUS", risk="HIGH",
         category=None, policy_type="ANTI_HARASSMENT", title="سياسة مكافحة التحرش في بيئة العمل",
         description="اتخاذ تدابير وقائية من التحرش، وتضمين لائحة تنظيم العمل حظره وجزاءاته وإجراءات الشكوى، وتوفير قناة بلاغ سرية.",
         authority="وزارة الموارد البشرية والتنمية الاجتماعية", reference="نظام مكافحة جريمة التحرش ونظام العمل",
         url=HRSD_URL, applies={"min_employees": 1}, sort=265),

    # ---------------- تراخيص الأنشطة (تنطبق حسب نشاط المنشأة المسجل)
    dict(code="SFDA_FOOD_LICENSE", kind="LICENSE", domain="SECTOR", frequency="RENEWAL", risk="CRITICAL",
         category=None, title="ترخيص المنشأة الغذائية (مصنع، مستودع، استيراد)",
         description="ترخيص مسبق من هيئة الغذاء والدواء لمصانع الأغذية ومستودعاتها ومراكز توزيعها ومستورديها، وتجديده قبل الانتهاء.",
         authority="الهيئة العامة للغذاء والدواء", reference="نظام الغذاء ولائحته التنفيذية", url="https://www.sfda.gov.sa",
         applies={"industries": ["أغذية", "غذائي", "غذاء", "مياه", "ثلج", "استيراد"]}, sort=600),
    dict(code="FOOD_HANDLERS_HEALTH", kind="LICENSE", domain="SECTOR", frequency="RENEWAL", risk="HIGH",
         category=None, title="الشهادات الصحية للعاملين في الأنشطة الغذائية",
         description="شهادة صحية سارية لكل عامل يتعامل مع الغذاء في المطاعم والمقاهي والمخابز والتموين، والالتزام بالاشتراطات الصحية البلدية.",
         authority="وزارة البلديات والإسكان — منصة بلدي", reference="الاشتراطات الصحية للأنشطة الغذائية", url="https://balady.gov.sa",
         applies={"industries": ["مطعم", "مطاعم", "مقهى", "مقاهي", "كافيه", "مخبز", "مخابز", "حلويات", "تموين", "أغذية", "غذائي"]}, sort=610),
    dict(code="HEALTH_FACILITY_LICENSE", kind="LICENSE", domain="SECTOR", frequency="RENEWAL", risk="CRITICAL",
         category=None, title="ترخيص المنشأة الصحية والتراخيص المهنية للممارسين",
         description="ترخيص وزارة الصحة للمنشأة الصحية الخاصة، وتصنيف وتسجيل كل ممارس صحي لدى الهيئة السعودية للتخصصات الصحية.",
         authority="وزارة الصحة — الهيئة السعودية للتخصصات الصحية", reference="نظام المؤسسات الصحية الخاصة ونظام مزاولة المهن الصحية",
         url="https://www.moh.gov.sa", applies={"industries": ["صحي", "طبي", "عيادة", "عيادات", "مستشفى", "أسنان", "صيدلية", "مختبر"]}, sort=620),
    dict(code="INVESTMENT_REGISTRATION", kind="LICENSE", domain="SECTOR", frequency="RENEWAL", risk="CRITICAL",
         category=None, title="تسجيل الاستثمار الأجنبي",
         description="ترخيص أو تسجيل الاستثمار لدى وزارة الاستثمار للمنشأة المملوكة لمستثمر أجنبي، والإبقاء عليه سارياً.",
         authority="وزارة الاستثمار", reference="نظام الاستثمار", url="https://misa.gov.sa",
         applies={"legal_types": ["BRANCH_OF_FOREIGN"]}, sort=630),
    dict(code="TOURISM_LICENSE", kind="LICENSE", domain="SECTOR", frequency="RENEWAL", risk="HIGH",
         category=None, title="ترخيص النشاط السياحي",
         description="ترخيص وزارة السياحة لمرافق الإيواء ووكالات السفر ومنظمي الرحلات، وتجديده.",
         authority="وزارة السياحة", reference="نظام السياحة", url="https://mt.gov.sa",
         applies={"industries": ["سياح", "فندق", "فنادق", "إيواء", "شقق مخدومة", "سفر", "رحلات"]}, sort=640),
    dict(code="TRANSPORT_LICENSE", kind="LICENSE", domain="SECTOR", frequency="RENEWAL", risk="HIGH",
         category=None, title="ترخيص نشاط النقل",
         description="ترخيص الهيئة العامة للنقل لنشاط نقل البضائع أو الركاب أو التوصيل أو تأجير السيارات، وبطاقات التشغيل.",
         authority="الهيئة العامة للنقل", reference="أنظمة ولوائح النقل البري", url="https://tga.gov.sa",
         applies={"industries": ["نقل", "شحن", "توصيل", "ليموزين", "تأجير سيارات", "لوجست"]}, sort=650),
    dict(code="EDUCATION_LICENSE", kind="LICENSE", domain="SECTOR", frequency="RENEWAL", risk="HIGH",
         category=None, title="ترخيص النشاط التعليمي أو التدريبي",
         description="ترخيص وزارة التعليم للمدارس ورياض الأطفال الأهلية، أو المؤسسة العامة للتدريب التقني والمهني لمراكز التدريب.",
         authority="وزارة التعليم — المؤسسة العامة للتدريب التقني والمهني", reference="لوائح التعليم الأهلي والتدريب الأهلي",
         url="https://moe.gov.sa", applies={"industries": ["تعليم", "مدرسة", "مدارس", "روضة", "حضانة", "تدريب"]}, sort=660),
    dict(code="MEDIA_LICENSE", kind="LICENSE", domain="SECTOR", frequency="RENEWAL", risk="MEDIUM",
         category=None, title="ترخيص النشاط الإعلامي والإعلاني",
         description="ترخيص النشاط الإعلامي أو الإعلاني من الجهة المختصة بالإعلام، والتحقق من ترخيص «موثوق» للمعلنين الأفراد.",
         authority="الجهة المختصة بتنظيم الإعلام", reference="نظام الإعلام المرئي والمسموع ولوائح الإعلان",
         url="https://www.gcam.gov.sa", applies={"industries": ["إعلام", "إعلان", "دعاية", "تسويق", "إنتاج مرئي", "نشر"]}, sort=670),
    dict(code="ECOMMERCE_DOCUMENTATION", kind="REGISTRATION", domain="SECTOR", frequency="ONCE", risk="MEDIUM",
         category=None, title="توثيق المتجر الإلكتروني",
         description="توثيق المتجر في منصة الأعمال التابعة لوزارة التجارة، وعرض البيانات والسياسات الإلزامية وفق نظام التجارة الإلكترونية.",
         authority="وزارة التجارة", reference="نظام التجارة الإلكترونية", url=MC_URL,
         applies={"industries": ["تجارة إلكترونية", "متجر إلكتروني", "متجر", "بيع إلكتروني"]}, sort=680),
    dict(code="CONTRACTOR_CLASSIFICATION", kind="LICENSE", domain="SECTOR", frequency="RENEWAL", risk="MEDIUM",
         category=None, title="تصنيف المقاولين",
         description="تصنيف ساري لازم للتعاقد على المشاريع الحكومية، يُجدَّد ويُحدَّث بقدرات المنشأة.",
         authority="وزارة البلديات والإسكان — تصنيف المقاولين", reference="نظام تصنيف المقاولين", url="https://www.momah.gov.sa",
         applies={"industries": ["مقاولات", "مقاول", "إنشاءات", "بناء"]}, sort=690),
]


from .requirements import REQUIREMENTS  # noqa: E402

for _o in OBLIGATIONS:
    _o.setdefault("requirements", REQUIREMENTS.get(_o["code"], {}).get("requirements", []))
    _o.setdefault("steps", REQUIREMENTS.get(_o["code"], {}).get("steps", []))


def applies_to(rule: dict, org: dict) -> tuple[bool, bool]:
    """هل ينطبق الالتزام على المنشأة؟ يرجع (ينطبق، يحتاج تأكيد بيانات).

    org: legal_type, employees_count|None, processes_personal_data, vat_registered|None, industry|None
    """
    uncertain = False
    lts = rule.get("legal_types") or []
    if lts and org["legal_type"] not in lts:
        return False, False
    if "min_employees" in rule:
        n = org.get("employees_count")
        if n is None:
            uncertain = True
        elif n < rule["min_employees"]:
            return False, False
    if rule.get("personal_data") and not org.get("processes_personal_data", True):
        return False, False
    if rule.get("vat"):
        v = org.get("vat_registered")
        if v is False:
            return False, False
        if v is None:
            uncertain = True
    inds = rule.get("industries")
    if inds:
        ind = (org.get("industry") or "")
        if not any(k in ind for k in inds):
            return False, False
    return True, uncertain
