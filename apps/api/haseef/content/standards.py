"""معايير الحوكمة وقوالب الهيكل الأساسي لكل كيان نظامي.

كل ما هنا محتوى أولي يبدأ "مسودة — قيد المراجعة" حتى يعتمده فريق حصيف القانوني.
المراجع مذكورة على مستوى النظام/اللائحة، لا أرقام مواد، إلى أن تُراجع.
تُزامن هذه القوائم مع قاعدة البيانات عند الإقلاع (تُضاف الرموز الجديدة فقط ولا يُمس ما عدّله الفريق).
"""

from __future__ import annotations

COMPANIES = ["LLC", "SIMPLIFIED_JOINT_STOCK", "CLOSED_JOINT_STOCK", "PUBLIC_JOINT_STOCK"]
JSC = ["CLOSED_JOINT_STOCK", "PUBLIC_JOINT_STOCK"]
ALL: list[str] = []

COMPANIES_LAW = "نظام الشركات (الصادر بالمرسوم الملكي م/132 بتاريخ 1443/12/1هـ) ولوائحه"
COMPANIES_LAW_URL = "https://cma.gov.sa/RulesRegulations/New_CompaniesLaw"
CGR = "لائحة حوكمة الشركات — هيئة السوق المالية"
CGR_URL = "https://cma.org.sa/RulesRegulations/Regulations/Documents/CorpGovReg.pdf"
PDPL = "نظام حماية البيانات الشخصية ولائحته التنفيذية — سدايا"
PDPL_URL = "https://sdaia.gov.sa"
MC_URL = "https://mc.gov.sa"

# (code, domain, level, severity, legal_types, title, description, reference, url, rule, sort)
STANDARDS: list[dict] = [
    # ---------------- الهيكل
    dict(code="STR_MANAGEMENT_DEFINED", domain="STRUCTURE", level="MANDATORY", severity="critical", applies=ALL,
         title="تحديد جهة الإدارة",
         description="للمنشأة جهة إدارة محددة بالاسم (مدير أو مجلس إدارة) مسؤولة نظاماً عن تصريف أعمالها.",
         reference=COMPANIES_LAW, url=COMPANIES_LAW_URL,
         rule={"check": "body_exists", "types": ["MANAGER", "BOARD"], "min_members": 1}, sort=10),
    dict(code="STR_BYLAWS", domain="STRUCTURE", level="MANDATORY", severity="high", applies=COMPANIES,
         title="عقد التأسيس أو النظام الأساس موثّق ومتوافق مع نظام الشركات",
         description="عقد التأسيس (أو النظام الأساس) محدّث ومتوافق مع أحكام نظام الشركات، ومودع لدى وزارة التجارة.",
         reference=COMPANIES_LAW, url=MC_URL,
         rule={"check": "profile_field", "field": "has_bylaws"}, sort=20),
    dict(code="STR_UBO", domain="DISCLOSURE", level="MANDATORY", severity="high", applies=COMPANIES,
         title="الإفصاح عن المستفيد الحقيقي",
         description="بيانات المستفيد الحقيقي (من يملك أو يسيطر فعلياً على الشركة) مُفصح عنها لوزارة التجارة ومحدّثة عند أي تغيير.",
         reference="متطلبات وزارة التجارة للإفصاح عن المستفيد الحقيقي", url=MC_URL,
         rule={"check": "profile_field", "field": "beneficial_owners_filed_on"}, sort=30),
    dict(code="STR_FS_FILED", domain="DISCLOSURE", level="MANDATORY", severity="high",
         applies=[*COMPANIES, "BRANCH_OF_FOREIGN"],
         title="إيداع القوائم المالية السنوية",
         description="إيداع القوائم المالية للسنة المالية المنتهية عبر منصة وزارة التجارة في المدة النظامية.",
         reference=COMPANIES_LAW, url=MC_URL,
         rule={"check": "profile_recent", "field": "last_fs_filed_on", "months": 18}, sort=40),
    dict(code="STR_TERMS_VALID", domain="STRUCTURE", level="MANDATORY", severity="medium", applies=ALL,
         title="سريان مدد العضوية",
         description="لا يوجد في المجلس أو اللجان عضو انتهت مدة عضويته دون تجديد أو تعيين بديل.",
         reference=COMPANIES_LAW, url=COMPANIES_LAW_URL,
         rule={"check": "terms_valid"}, sort=50),

    # ---------------- المجلس
    dict(code="JSC_BOARD_EXISTS", domain="BOARD", level="MANDATORY", severity="critical", applies=JSC,
         title="وجود مجلس إدارة",
         description="يدير شركة المساهمة مجلس إدارة يحدد النظام الأساس عدد أعضائه.",
         reference=COMPANIES_LAW, url=COMPANIES_LAW_URL,
         rule={"check": "body_exists", "types": ["BOARD"], "min_members": 1}, sort=100),
    dict(code="JSC_BOARD_MIN3", domain="BOARD", level="MANDATORY", severity="high", applies=JSC,
         title="لا يقل أعضاء مجلس الإدارة عن ثلاثة",
         description="عدد أعضاء مجلس إدارة شركة المساهمة لا يقل عن ثلاثة أعضاء.",
         reference=COMPANIES_LAW, url=COMPANIES_LAW_URL,
         rule={"check": "board_min_members", "min": 3}, sort=110),
    dict(code="BOARD_HAS_CHAIR", domain="BOARD", level="MANDATORY", severity="medium", applies=JSC,
         title="تعيين رئيس لمجلس الإدارة",
         description="يعيّن المجلس من بين أعضائه رئيساً، ويجوز تعيين نائب له.",
         reference=COMPANIES_LAW, url=COMPANIES_LAW_URL,
         rule={"check": "has_position", "body": "BOARD", "position": "CHAIR"}, sort=120),
    dict(code="PJSC_INDEPENDENTS", domain="BOARD", level="MANDATORY", severity="high", applies=["PUBLIC_JOINT_STOCK"],
         title="الأعضاء المستقلون: اثنان أو ثلث المجلس أيهما أكثر",
         description="لا يقل عدد الأعضاء المستقلين في مجلس إدارة الشركة المدرجة عن عضوين أو ثلث أعضاء المجلس، أيهما أكثر.",
         reference=CGR, url=CGR_URL,
         rule={"check": "independent_min", "min": 2, "ratio": 0.333333}, sort=130),
    dict(code="CJSC_INDEPENDENTS", domain="BOARD", level="RECOMMENDED", severity="medium", applies=["CLOSED_JOINT_STOCK"],
         title="وجود أعضاء مستقلين في المجلس (ممارسة فضلى)",
         description="يُستحسن أن يضم المجلس عضواً مستقلاً واحداً على الأقل لتعزيز الرقابة وتجنب تعارض المصالح.",
         reference=CGR, url=CGR_URL,
         rule={"check": "independent_min", "min": 1, "ratio": 0}, sort=131),
    dict(code="PJSC_MAJORITY_NONEXEC", domain="BOARD", level="MANDATORY", severity="medium", applies=["PUBLIC_JOINT_STOCK"],
         title="أغلبية المجلس من غير التنفيذيين",
         description="تكون أغلبية أعضاء مجلس الإدارة من الأعضاء غير التنفيذيين.",
         reference=CGR, url=CGR_URL,
         rule={"check": "majority_non_exec"}, sort=140),
    dict(code="PJSC_CHAIR_NONEXEC", domain="BOARD", level="MANDATORY", severity="medium", applies=["PUBLIC_JOINT_STOCK"],
         title="فصل رئاسة المجلس عن المنصب التنفيذي",
         description="لا يجمع رئيس مجلس الإدارة بين رئاسة المجلس وأي منصب تنفيذي في الشركة.",
         reference=CGR, url=CGR_URL,
         rule={"check": "chair_non_exec"}, sort=150),
    dict(code="JSC_SECRETARY", domain="BOARD", level="MANDATORY", severity="medium", applies=JSC,
         title="أمين سر لمجلس الإدارة",
         description="يعيّن المجلس أمين سر يتولى تدوين محاضر الاجتماعات وحفظها ومتابعة القرارات.",
         reference=COMPANIES_LAW, url=COMPANIES_LAW_URL,
         rule={"check": "body_or_position", "types": ["COMPANY_SECRETARY"], "body": "BOARD", "position": "SECRETARY"}, sort=160),

    # ---------------- اللجان والرقابة
    dict(code="JSC_AUDIT_COMMITTEE", domain="AUDIT", level="MANDATORY", severity="high", applies=JSC,
         title="لجنة مراجعة من ثلاثة أعضاء على الأقل من غير التنفيذيين",
         description="تُشكّل لجنة مراجعة لا يقل أعضاؤها عن ثلاثة، ولا يكون من بينهم أعضاء تنفيذيون.",
         reference=COMPANIES_LAW, url=COMPANIES_LAW_URL,
         rule={"check": "committee", "type": "AUDIT_COMMITTEE", "min": 3, "no_executives": True}, sort=200),
    dict(code="PJSC_NRC", domain="AUDIT", level="MANDATORY", severity="high", applies=["PUBLIC_JOINT_STOCK"],
         title="لجنة الترشيحات والمكافآت",
         description="تُشكّل لجنة للترشيحات والمكافآت (أو لجنتان منفصلتان) وفق لائحة حوكمة الشركات.",
         reference=CGR, url=CGR_URL,
         rule={"check": "committee", "type": "NOMINATION_REMUNERATION_COMMITTEE", "min": 3, "no_executives": False}, sort=210),
    dict(code="PJSC_INTERNAL_AUDIT", domain="AUDIT", level="MANDATORY", severity="medium", applies=["PUBLIC_JOINT_STOCK"],
         title="وحدة أو إدارة للمراجعة الداخلية",
         description="تُنشأ وحدة مراجعة داخلية تقيّم نظام الرقابة الداخلية وترفع تقاريرها للجنة المراجعة.",
         reference=CGR, url=CGR_URL,
         rule={"check": "body_exists", "types": ["INTERNAL_AUDIT"], "min_members": 0}, sort=220),
    dict(code="JSC_AUDITOR", domain="AUDIT", level="MANDATORY", severity="high", applies=JSC,
         title="تعيين مراجع حسابات خارجي",
         description="تعيّن الجمعية العامة مراجع حسابات مرخصاً لمراجعة القوائم المالية السنوية.",
         reference=COMPANIES_LAW, url=COMPANIES_LAW_URL,
         rule={"check": "profile_field", "field": "auditor_name"}, sort=230),
    dict(code="LLC_AUDITOR", domain="AUDIT", level="MANDATORY", severity="high", applies=["LLC", "SIMPLIFIED_JOINT_STOCK"],
         title="تعيين مراجع حسابات (تُعفى المنشآت متناهية الصغر والصغيرة وفق الضوابط)",
         description="يُعيَّن مراجع حسابات مرخص، مع مراعاة إعفاء المنشآت متناهية الصغر والصغيرة وفق ما تحدده اللوائح.",
         reference=COMPANIES_LAW, url=COMPANIES_LAW_URL,
         rule={"check": "profile_field", "field": "auditor_name", "exempt_sizes": ["MICRO", "SMALL"]}, sort=240),

    # ---------------- الجمعيات
    dict(code="JSC_ANNUAL_ASSEMBLY", domain="ASSEMBLY", level="MANDATORY", severity="high", applies=JSC,
         title="انعقاد الجمعية العامة العادية سنوياً",
         description="تنعقد الجمعية العامة العادية مرة على الأقل في السنة خلال الأشهر الستة التالية لنهاية السنة المالية.",
         reference=COMPANIES_LAW, url=COMPANIES_LAW_URL,
         rule={"check": "profile_recent", "field": "last_assembly_on", "months": 15}, sort=300),
    dict(code="LLC_ANNUAL_PARTNERS", domain="ASSEMBLY", level="RECOMMENDED", severity="medium", applies=["LLC", "SIMPLIFIED_JOINT_STOCK"],
         title="اجتماع سنوي للشركاء أو المساهمين للمصادقة على القوائم المالية",
         description="يُستحسن توثيق قرار سنوي للشركاء/المساهمين بالمصادقة على القوائم المالية وإبراء ذمة الإدارة.",
         reference=COMPANIES_LAW, url=COMPANIES_LAW_URL,
         rule={"check": "profile_recent", "field": "last_assembly_on", "months": 15}, sort=310),

    # ---------------- السياسات
    dict(code="POL_CONFLICT_OF_INTEREST", domain="POLICIES", level="MANDATORY", severity="medium", applies=JSC,
         title="سياسة معتمدة لتعارض المصالح",
         description="سياسة مكتوبة ومعتمدة تنظم الإفصاح عن تعارض المصالح والتعامل مع الأطراف ذات العلاقة.",
         reference=COMPANIES_LAW, url=COMPANIES_LAW_URL,
         rule={"check": "policy_active", "policy_type": "CONFLICT_OF_INTEREST"}, sort=400),
    dict(code="POL_CONFLICT_OF_INTEREST_REC", domain="POLICIES", level="RECOMMENDED", severity="medium",
         applies=["LLC", "SIMPLIFIED_JOINT_STOCK"],
         title="سياسة تعارض المصالح (ممارسة فضلى)",
         description="يُستحسن اعتماد سياسة لتعارض المصالح تُلزم المديرين والموظفين بالإفصاح.",
         reference=COMPANIES_LAW, url=COMPANIES_LAW_URL,
         rule={"check": "policy_active", "policy_type": "CONFLICT_OF_INTEREST"}, sort=401),
    dict(code="POL_RELATED_PARTIES", domain="POLICIES", level="MANDATORY", severity="medium", applies=JSC,
         title="ضوابط تعاملات الأطراف ذات العلاقة",
         description="إجراءات معتمدة للموافقة على العقود والتعاملات التي يكون لأعضاء المجلس أو كبار التنفيذيين مصلحة فيها.",
         reference=COMPANIES_LAW, url=COMPANIES_LAW_URL,
         rule={"check": "policy_active", "policy_type": "RELATED_PARTIES"}, sort=410),
    dict(code="POL_WHISTLEBLOWING", domain="POLICIES", level="RECOMMENDED", severity="medium", applies=COMPANIES,
         title="سياسة الإبلاغ عن المخالفات",
         description="قناة سرية للإبلاغ عن المخالفات مع حماية المبلّغ.",
         reference=CGR, url=CGR_URL,
         rule={"check": "policy_active", "policy_type": "WHISTLEBLOWING"}, sort=420),
    dict(code="POL_CODE_OF_CONDUCT", domain="POLICIES", level="RECOMMENDED", severity="medium", applies=ALL,
         title="ميثاق السلوك المهني",
         description="ميثاق مكتوب يوضح قيم المنشأة وسلوكيات العاملين المتوقعة.",
         reference=CGR, url=CGR_URL,
         rule={"check": "policy_active", "policy_type": "CODE_OF_CONDUCT"}, sort=430),
    dict(code="POL_DOA", domain="POLICIES", level="RECOMMENDED", severity="medium", applies=COMPANIES,
         title="مصفوفة صلاحيات معتمدة",
         description="تحديد من يملك صلاحية الاعتماد المالي والتعاقدي وحدودها (مصفوفة الصلاحيات).",
         reference=CGR, url=CGR_URL,
         rule={"check": "doa_exists"}, sort=440),

    # ---------------- حماية البيانات
    dict(code="PDPL_PRIVACY_POLICY", domain="PDPL", level="MANDATORY", severity="high", applies=ALL,
         title="سياسة خصوصية معلنة ومعتمدة",
         description="سياسة خصوصية متاحة لأصحاب البيانات توضح الغرض من الجمع والمعالجة وحقوقهم وطرق التواصل.",
         reference=PDPL, url=PDPL_URL,
         rule={"check": "policy_active", "policy_type": "PRIVACY_POLICY", "requires_personal_data": True}, sort=500),
    dict(code="PDPL_ROPA", domain="PDPL", level="MANDATORY", severity="medium", applies=ALL,
         title="سجل أنشطة معالجة البيانات الشخصية",
         description="سجل يوثق أنشطة المعالجة: الغرض، فئات البيانات، المستلمين، مدة الحفظ، والنقل خارج المملكة.",
         reference=PDPL, url=PDPL_URL,
         rule={"check": "ropa_exists", "requires_personal_data": True}, sort=510),
    dict(code="PDPL_BREACH_RESPONSE", domain="PDPL", level="MANDATORY", severity="medium", applies=ALL,
         title="إجراء الإبلاغ عن حوادث تسرب البيانات",
         description="إجراء موثق لاكتشاف حوادث التسرب وإبلاغ الجهة المختصة خلال المدة النظامية وإشعار أصحاب البيانات عند الحاجة.",
         reference=PDPL, url=PDPL_URL,
         rule={"check": "policy_active", "policy_type": "BREACH_RESPONSE", "requires_personal_data": True}, sort=520),
    dict(code="PDPL_DPO", domain="PDPL", level="RECOMMENDED", severity="medium", applies=ALL,
         title="تعيين مسؤول لحماية البيانات الشخصية",
         description="تعيين شخص مسؤول عن الالتزام بحماية البيانات (إلزامي في الحالات التي تحددها اللائحة والقواعد الصادرة من سدايا).",
         reference=PDPL, url=PDPL_URL,
         rule={"check": "body_exists", "types": ["DPO"], "min_members": 1, "requires_personal_data": True}, sort=530),
]


# -------------------------------------------------------------- قوالب الهيكل
# (body_type, name, mandate, meetings_per_year)
STRUCTURE_TEMPLATES: dict[str, list[tuple[str, str, str, int | None]]] = {
    "SOLE_PROPRIETORSHIP": [
        ("OWNER", "مالك المؤسسة", "صاحب الصلاحية النهائية والمسؤول شخصياً عن التزامات المؤسسة.", None),
        ("MANAGER", "المدير المسؤول", "يدير الأعمال اليومية بتفويض من المالك ويُسجَّل في السجل التجاري عند تعيينه.", None),
    ],
    "LLC": [
        ("PARTNERS_ASSEMBLY", "جمعية الشركاء", "تعديل عقد التأسيس، تعيين المديرين وعزلهم، المصادقة على القوائم المالية، توزيع الأرباح.", 1),
        ("MANAGER", "المدير / المديرون", "إدارة الشركة وتمثيلها أمام الغير وفق عقد التأسيس وحدود الصلاحيات.", None),
        ("EXECUTIVE_MANAGEMENT", "الإدارة التنفيذية", "تنفيذ الخطط وإدارة العمليات اليومية ورفع التقارير للمدير.", None),
    ],
    "SIMPLIFIED_JOINT_STOCK": [
        ("GENERAL_ASSEMBLY", "الجمعية العامة للمساهمين", "القرارات الجوهرية وفق النظام الأساس (يجوز ألا تُعقد إذا نص النظام الأساس على ذلك).", 1),
        ("MANAGER", "المدير / مجلس الإدارة", "إدارة الشركة وفق ما يحدده النظام الأساس (مدير واحد أو أكثر أو مجلس).", None),
        ("EXECUTIVE_MANAGEMENT", "الإدارة التنفيذية", "إدارة العمليات اليومية.", None),
    ],
    "CLOSED_JOINT_STOCK": [
        ("GENERAL_ASSEMBLY", "الجمعية العامة للمساهمين", "انتخاب المجلس، تعيين المراجع، المصادقة على القوائم المالية، توزيع الأرباح.", 1),
        ("BOARD", "مجلس الإدارة", "الإشراف على الإدارة ووضع الاستراتيجية واعتماد السياسات والصلاحيات.", 4),
        ("AUDIT_COMMITTEE", "لجنة المراجعة", "مراقبة القوائم المالية والرقابة الداخلية والتوصية بتعيين المراجع الخارجي.", 4),
        ("COMPANY_SECRETARY", "أمين سر المجلس", "تنظيم اجتماعات المجلس وتدوين محاضره ومتابعة قراراته.", None),
        ("EXECUTIVE_MANAGEMENT", "الإدارة التنفيذية", "تنفيذ استراتيجية المجلس وإدارة العمليات اليومية.", None),
    ],
    "PUBLIC_JOINT_STOCK": [
        ("GENERAL_ASSEMBLY", "الجمعية العامة للمساهمين", "انتخاب المجلس، تعيين المراجع، المصادقة على القوائم المالية، توزيع الأرباح.", 1),
        ("BOARD", "مجلس الإدارة", "الإشراف على الإدارة ووضع الاستراتيجية واعتماد السياسات والصلاحيات.", 4),
        ("AUDIT_COMMITTEE", "لجنة المراجعة", "مراقبة القوائم المالية والرقابة الداخلية والتوصية بتعيين المراجع الخارجي.", 4),
        ("NOMINATION_REMUNERATION_COMMITTEE", "لجنة الترشيحات والمكافآت", "معايير عضوية المجلس، تقييم الأداء، سياسة المكافآت.", 2),
        ("RISK_COMMITTEE", "لجنة إدارة المخاطر", "تحديد المخاطر الجوهرية ومستوى المخاطر المقبول ومتابعتها.", 2),
        ("COMPANY_SECRETARY", "أمين سر المجلس", "تنظيم اجتماعات المجلس وتدوين محاضره ومتابعة قراراته.", None),
        ("INTERNAL_AUDIT", "المراجعة الداخلية", "تقييم الرقابة الداخلية ورفع التقارير للجنة المراجعة.", None),
        ("COMPLIANCE_FUNCTION", "إدارة الالتزام", "متابعة الالتزام بالأنظمة واللوائح وتعليمات هيئة السوق المالية.", None),
        ("EXECUTIVE_MANAGEMENT", "الإدارة التنفيذية", "تنفيذ استراتيجية المجلس وإدارة العمليات اليومية.", None),
    ],
    "BRANCH_OF_FOREIGN": [
        ("MANAGER", "مدير الفرع", "تمثيل الشركة الأم في المملكة وإدارة الفرع وفق الصلاحيات الممنوحة له.", None),
        ("EXECUTIVE_MANAGEMENT", "الإدارة التنفيذية للفرع", "إدارة العمليات اليومية للفرع.", None),
    ],
}

BODY_LABEL = {
    "OWNER": "المالك", "GENERAL_ASSEMBLY": "الجمعية العامة", "PARTNERS_ASSEMBLY": "جمعية الشركاء", "BOARD": "مجلس الإدارة",
    "MANAGER": "المدير", "EXECUTIVE_MANAGEMENT": "الإدارة التنفيذية", "AUDIT_COMMITTEE": "لجنة المراجعة",
    "NOMINATION_REMUNERATION_COMMITTEE": "لجنة الترشيحات والمكافآت", "RISK_COMMITTEE": "لجنة المخاطر",
    "EXECUTIVE_COMMITTEE": "اللجنة التنفيذية", "OTHER_COMMITTEE": "لجنة أخرى", "COMPANY_SECRETARY": "أمين السر",
    "INTERNAL_AUDIT": "المراجعة الداخلية", "COMPLIANCE_FUNCTION": "إدارة الالتزام", "DPO": "مسؤول حماية البيانات",
}
