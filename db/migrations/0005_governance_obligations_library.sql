-- =====================================================================
-- 0005 — معايير الحوكمة، هيكل المنشأة، كتالوج الالتزامات، المكتبة المرجعية
--
--   الكتالوجات (معايير/التزامات/مكتبة) على مستوى المنصة: يكتبها فريق حصيف،
--   ويقرأ العميل منها الظاهر فقط. كل عنصر يبدأ "مسودة — قيد المراجعة" حتى يُعتمد.
--   هيكل المنشأة ونتائج فحصه والتزاماتها خاصة بكل منشأة (RLS).
-- =====================================================================

-- ---------- عام: حالة المراجعة والظهور ----------
-- review_status: DRAFT = يظهر للعميل مع شارة "مسودة — قيد المراجعة"، APPROVED = معتمد.
-- is_visible:    إخفاء/إظهار للعملاء دون حذف.

-- ---------- معايير الحوكمة ----------
CREATE TABLE gov_standards (
    code                varchar(40) PRIMARY KEY,
    domain              varchar(20) NOT NULL
        CHECK (domain IN ('STRUCTURE','BOARD','ASSEMBLY','AUDIT','DISCLOSURE','POLICIES','PDPL')),
    title               text NOT NULL,
    description         text NOT NULL,
    legal_reference     text,
    source_url          text,
    level               varchar(12) NOT NULL CHECK (level IN ('MANDATORY','RECOMMENDED')),
    severity            varchar(10) NOT NULL CHECK (severity IN ('critical','high','medium')),
    applies_legal_types text[] NOT NULL DEFAULT '{}',     -- فارغة = كل الكيانات
    rule                jsonb NOT NULL,                    -- {"check": "...", ...} يقيّمه الخادم
    is_visible          boolean NOT NULL DEFAULT true,
    review_status       varchar(10) NOT NULL DEFAULT 'DRAFT' CHECK (review_status IN ('DRAFT','APPROVED')),
    sort                smallint NOT NULL DEFAULT 100,
    updated_by          uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ---------- ملف حوكمة المنشأة ----------
CREATE TABLE org_governance_profiles (
    org_id                      uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    employees_count             integer CHECK (employees_count >= 0),
    fiscal_year_end_month       smallint NOT NULL DEFAULT 12 CHECK (fiscal_year_end_month BETWEEN 1 AND 12),
    processes_personal_data     boolean NOT NULL DEFAULT true,
    vat_registered              boolean,
    has_bylaws                  boolean NOT NULL DEFAULT false,   -- عقد التأسيس / النظام الأساس محدّث
    bylaws_updated_on           date,
    auditor_name                text,
    auditor_appointed_on        date,
    beneficial_owners_filed_on  date,                              -- الإفصاح عن المستفيد الحقيقي
    last_assembly_on            date,                              -- آخر جمعية عامة / اجتماع شركاء
    last_fs_filed_on            date,                              -- آخر إيداع للقوائم المالية
    template_applied_at         timestamptz,
    updated_by                  uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE org_bodies (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    body_type           varchar(30) NOT NULL
        CHECK (body_type IN ('OWNER','GENERAL_ASSEMBLY','PARTNERS_ASSEMBLY','BOARD','MANAGER','EXECUTIVE_MANAGEMENT',
                             'AUDIT_COMMITTEE','NOMINATION_REMUNERATION_COMMITTEE','RISK_COMMITTEE','EXECUTIVE_COMMITTEE',
                             'OTHER_COMMITTEE','COMPANY_SECRETARY','INTERNAL_AUDIT','COMPLIANCE_FUNCTION','DPO')),
    name                varchar(150) NOT NULL,
    mandate             text,
    meetings_per_year   smallint CHECK (meetings_per_year BETWEEN 0 AND 52),
    reports_to          uuid REFERENCES org_bodies(id) ON DELETE SET NULL,
    sort                smallint NOT NULL DEFAULT 100,
    from_template       boolean NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_org_bodies_org ON org_bodies(org_id, sort);

CREATE TABLE org_body_members (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    body_id             uuid NOT NULL REFERENCES org_bodies(id) ON DELETE CASCADE,
    full_name           varchar(150) NOT NULL,
    position            varchar(20) NOT NULL DEFAULT 'MEMBER'
        CHECK (position IN ('CHAIR','VICE_CHAIR','MEMBER','SECRETARY','HEAD')),
    is_independent      boolean NOT NULL DEFAULT false,
    is_executive        boolean NOT NULL DEFAULT false,
    appointed_on        date,
    term_ends_on        date,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (term_ends_on IS NULL OR appointed_on IS NULL OR term_ends_on >= appointed_on)
);
CREATE INDEX idx_org_body_members_body ON org_body_members(body_id);

CREATE TABLE gov_check_runs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    run_by              uuid REFERENCES users(id) ON DELETE SET NULL,
    passed              smallint NOT NULL,
    failed              smallint NOT NULL,
    not_applicable      smallint NOT NULL,
    structure_score     numeric(5,1),                 -- نسبة المعايير الإلزامية المستوفاة (موزونة بالخطورة)
    results             jsonb NOT NULL,               -- [{code,status,message}]
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_gov_check_runs_org ON gov_check_runs(org_id, created_at DESC);

-- ---------- كتالوج الالتزامات والسياسات المطلوبة ----------
CREATE TABLE obligation_catalog (
    code                varchar(40) PRIMARY KEY,
    kind                varchar(15) NOT NULL CHECK (kind IN ('LICENSE','REGISTRATION','FILING','POLICY','PRACTICE')),
    domain              varchar(20) NOT NULL
        CHECK (domain IN ('COMMERCIAL','MUNICIPAL','LABOR','TAX','SAFETY','PDPL','GOVERNANCE','AML','INSURANCE')),
    title               text NOT NULL,
    description         text NOT NULL,
    authority           text,                         -- الجهة المختصة
    legal_reference     text,
    source_url          text,
    frequency           varchar(12) NOT NULL CHECK (frequency IN ('ONCE','ANNUAL','RENEWAL','EVENT','CONTINUOUS')),
    risk_level          varchar(10) NOT NULL CHECK (risk_level IN ('CRITICAL','HIGH','MEDIUM')),
    compliance_category varchar(30),                  -- يربط الترخيص بنوع عنصر الامتثال للمتابعة التلقائية
    policy_type         varchar(30),                  -- يربط السياسة المطلوبة بنوع السياسة الداخلية
    applies             jsonb NOT NULL DEFAULT '{}',  -- قواعد الانطباق: legal_types, sizes, min_employees, personal_data, vat
    is_visible          boolean NOT NULL DEFAULT true,
    review_status       varchar(10) NOT NULL DEFAULT 'DRAFT' CHECK (review_status IN ('DRAFT','APPROVED')),
    sort                smallint NOT NULL DEFAULT 100,
    updated_by          uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE org_obligations (
    org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code                varchar(40) NOT NULL REFERENCES obligation_catalog(code) ON DELETE CASCADE,
    status              varchar(15) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','IN_PLACE','NOT_APPLICABLE')),
    source              varchar(6) NOT NULL DEFAULT 'AUTO' CHECK (source IN ('AUTO','MANUAL')),
    note                text,
    updated_by          uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, code)
);

-- أنواع سياسات إضافية تطلبها الالتزامات
ALTER TABLE internal_policies DROP CONSTRAINT IF EXISTS internal_policies_policy_type_check;
ALTER TABLE internal_policies ADD CONSTRAINT internal_policies_policy_type_check
    CHECK (policy_type IN ('PRIVACY_POLICY','CONFLICT_OF_INTEREST','WHISTLEBLOWING','CODE_OF_CONDUCT','DATA_RETENTION',
                           'INFOSEC','BREACH_RESPONSE','RELATED_PARTIES','BOARD_CHARTER','AUDIT_COMMITTEE_CHARTER',
                           'DISCLOSURE','DOA','RISK_MANAGEMENT','AML','WORK_REGULATION','HEALTH_SAFETY','OTHER'));

-- نص السياسة داخل حصيف (عند تبنّي نموذج من المكتبة) ومصدرها
ALTER TABLE internal_policies
    ADD COLUMN body_md text,
    ADD COLUMN source_library_id uuid;

-- ---------- المكتبة المرجعية ----------
CREATE TABLE library_documents (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                varchar(80) UNIQUE,           -- للمحتوى الذي يجهّزه حصيف (لا يُكرَّر عند التحديث)
    kind                varchar(10) NOT NULL CHECK (kind IN ('TEMPLATE','LAW','GUIDE','FILE')),
    category            varchar(20) NOT NULL
        CHECK (category IN ('GOVERNANCE','POLICIES','PDPL','LABOR','TAX','COMMERCIAL','SAFETY','AML')),
    title               text NOT NULL,
    summary             text,
    body_md             text,                         -- نص النموذج (TEMPLATE / GUIDE)
    url                 text,                         -- رابط رسمي (LAW)
    file_name           text,
    file_mime           text,
    file_size           integer CHECK (file_size >= 0),
    file_key            text,                         -- مسار التخزين (FILE)
    policy_type         varchar(30),                  -- لنسخ النموذج إلى سياسات المنشأة
    applies_legal_types text[] NOT NULL DEFAULT '{}',
    related_codes       text[] NOT NULL DEFAULT '{}', -- معايير/التزامات مرتبطة
    is_visible          boolean NOT NULL DEFAULT true,
    review_status       varchar(10) NOT NULL DEFAULT 'DRAFT' CHECK (review_status IN ('DRAFT','APPROVED')),
    min_plan            varchar(30) REFERENCES plans(tier),
    version             varchar(20) NOT NULL DEFAULT '1.0',
    sort                smallint NOT NULL DEFAULT 100,
    created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_by          uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (kind <> 'LAW'  OR url IS NOT NULL),
    CHECK (kind <> 'FILE' OR file_key IS NOT NULL),
    CHECK (kind NOT IN ('TEMPLATE','GUIDE') OR body_md IS NOT NULL)
);
CREATE INDEX idx_library_category ON library_documents(category, sort);
ALTER TABLE internal_policies ADD CONSTRAINT internal_policies_source_library_fk
    FOREIGN KEY (source_library_id) REFERENCES library_documents(id) ON DELETE SET NULL;

-- ---------- العزل والصلاحيات ----------
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['org_governance_profiles','org_bodies','org_body_members','gov_check_runs','org_obligations'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app.current_org_id()) WITH CHECK (org_id = app.current_org_id())', t);
    END LOOP;
END $$;

-- الكتالوجات: العميل يقرأ الظاهر فقط ولا يكتب.
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['gov_standards','obligation_catalog','library_documents'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY visible_to_clients ON %I FOR SELECT TO haseef_app USING (is_visible)', t);
        EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I FROM haseef_app', t);
        EXECUTE format('GRANT SELECT ON %I TO haseef_app', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO haseef_platform', t);
    END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON org_governance_profiles, org_bodies, org_body_members, gov_check_runs, org_obligations
    TO haseef_app, haseef_platform;
-- سجل الفحص للإضافة فقط
REVOKE UPDATE, DELETE ON gov_check_runs FROM haseef_app;
