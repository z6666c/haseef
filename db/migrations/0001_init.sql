-- =====================================================================
-- حَصيف — المخطط الأساسي لقاعدة البيانات (الإصدار 1.1)
-- PostgreSQL 16 + pgvector 0.8
--
-- مبادئ التصميم:
--   1. العزل بين المستأجرين مُطبَّق داخل قاعدة البيانات عبر Row-Level Security،
--      لا عبر انضباط المطورين فقط. الخادم يتصل بالدور haseef_app (بلا BYPASSRLS)
--      ويضبط app.org_id في بداية كل معاملة.
--   2. الحالات المشتقة من التاريخ (ساري/قارب على الانتهاء/منتهٍ) لا تُخزَّن،
--      بل تُحسب في العرض v_compliance_items بتوقيت الرياض.
--   3. التنبيهات تُسجَّل في alert_dispatches بمفتاح فريد يمنع التكرار ويصمد
--      أمام التجديد وتعطّل المهمة اليومية.
--   4. الملفات لا تُخزَّن كروابط دائمة؛ نخزّن مفتاح الكائن فقط وتُولَّد روابط موقّعة مؤقتة.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA IF NOT EXISTS app;

-- ---------------------------------------------------------------------
-- أدوات مساعدة
-- ---------------------------------------------------------------------

-- المنشأة الحالية للمعاملة. ترجع NULL إن لم تُضبط، فتمنع RLS كل الصفوف.
CREATE OR REPLACE FUNCTION app.current_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.org_id', true), '')::uuid
$$;

-- تاريخ اليوم بتوقيت الرياض (الحالات والتنبيهات تُحسب به لا بتوقيت الخادم).
CREATE OR REPLACE FUNCTION app.today_riyadh() RETURNS date
LANGUAGE sql STABLE AS $$
    SELECT (now() AT TIME ZONE 'Asia/Riyadh')::date
$$;

CREATE OR REPLACE FUNCTION app.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- 1. المنشآت (المستأجرون)
-- ---------------------------------------------------------------------
CREATE TABLE organizations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cr_number           varchar(20) UNIQUE NOT NULL,
    name                varchar(255) NOT NULL,
    entity_legal_type   varchar(50)  NOT NULL
        CHECK (entity_legal_type IN ('LLC','SOLE_PROPRIETORSHIP','CLOSED_JOINT_STOCK','SIMPLIFIED_JOINT_STOCK','PUBLIC_JOINT_STOCK','BRANCH_OF_FOREIGN')),
    industry_type       varchar(100),
    commercial_size     varchar(20)
        CHECK (commercial_size IN ('MICRO','SMALL','MEDIUM')),
    parent_org_id       uuid REFERENCES organizations(id) ON DELETE SET NULL, -- للفروع والشركات القابضة (باقة Enterprise)
    -- مؤشر حصافة: NULL حتى أول احتساب فعلي؛ المنشأة الجديدة ليست ممتثلة 100% افتراضياً.
    haseef_score        smallint CHECK (haseef_score BETWEEN 0 AND 100),
    score_breakdown     jsonb,          -- تفصيل الأركان والأوزان المستخدمة فعلياً
    score_computed_at   timestamptz,
    timezone            text NOT NULL DEFAULT 'Asia/Riyadh',
    is_active           boolean NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_organizations_updated BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ---------------------------------------------------------------------
-- 2. المستخدمون (هوية عامة) + العضويات (ربط المستخدم بعدة منشآت)
--    المستشار أو المحاسب الخارجي يخدم عدة منشآت بحساب واحد.
-- ---------------------------------------------------------------------
CREATE TABLE users (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email               citext UNIQUE NOT NULL,
    phone_number        varchar(20),                -- E.164، غير فريد (رقم الشركة قد يُشارك)
    phone_verified_at   timestamptz,
    full_name           varchar(100) NOT NULL,
    password_hash       varchar(255) NOT NULL,      -- argon2id
    is_platform_admin   boolean NOT NULL DEFAULT false, -- فريق حصيف (admin.haseef.sa)
    is_active           boolean NOT NULL DEFAULT true,
    last_login_at       timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE memberships (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role                varchar(30) NOT NULL
        CHECK (role IN ('ORG_ADMIN','COMPLIANCE_OFFICER','DPO','VIEWER','EXTERNAL_ADVISOR')),
    receives_alerts     boolean NOT NULL DEFAULT true,
    alert_channels      text[] NOT NULL DEFAULT ARRAY['WHATSAPP','EMAIL'],
    is_active           boolean NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, user_id)
);
CREATE INDEX idx_memberships_user ON memberships(user_id);

-- ---------------------------------------------------------------------
-- 3. الباقات والاشتراكات وحدود الاستخدام
-- ---------------------------------------------------------------------
CREATE TABLE plans (
    tier                varchar(30) PRIMARY KEY
        CHECK (tier IN ('ESSENTIAL','PROFESSIONAL_GRC','ENTERPRISE')),
    name_ar             varchar(100) NOT NULL,
    monthly_price_sar   numeric(10,2) NOT NULL,
    yearly_price_sar    numeric(10,2) NOT NULL,
    -- الميزات المتاحة تحدد أيضاً أركان مؤشر حصافة التي تُحتسب للمنشأة.
    features            text[] NOT NULL,
    monthly_ai_audits   int,                         -- NULL = غير محدود
    monthly_whatsapp_alerts int                      -- NULL = غير محدود
);

CREATE TABLE subscriptions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    plan_tier           varchar(30) NOT NULL REFERENCES plans(tier),
    billing_cycle       varchar(10) NOT NULL CHECK (billing_cycle IN ('MONTHLY','YEARLY')),
    starts_at           timestamptz NOT NULL,
    ends_at             timestamptz NOT NULL,
    billing_status      varchar(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (billing_status IN ('TRIAL','ACTIVE','PAST_DUE','CANCELED','EXPIRED')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at)
);
-- اشتراك فعّال واحد على الأكثر لكل منشأة.
CREATE UNIQUE INDEX uq_subscriptions_one_live
    ON subscriptions(org_id) WHERE billing_status IN ('TRIAL','ACTIVE','PAST_DUE');

-- ---------------------------------------------------------------------
-- 4. عناصر الامتثال التشغيلي (السجل التجاري، بلدي، التأمين الصحي، ...)
--    لا يوجد عمود status مخزّن؛ الحالة تُشتق في v_compliance_items.
-- ---------------------------------------------------------------------
CREATE TABLE compliance_items (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    category            varchar(30) NOT NULL
        CHECK (category IN ('COMMERCIAL_REG','BALADY','CHI_INSURANCE','GOSI','QIWA_NITAQAT','WPS','ZATCA','CIVIL_DEFENSE','CHAMBER','OTHER')),
    title               varchar(255) NOT NULL,
    reference_number    varchar(100),
    issue_date          date,
    expiry_date         date NOT NULL,
    risk_level          varchar(10) NOT NULL DEFAULT 'HIGH'
        CHECK (risk_level IN ('CRITICAL','HIGH','MEDIUM')),
    renewal_url         text,                        -- رابط المنصة الحكومية المعنية
    owner_membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL,
    archived_at         timestamptz,                 -- عند الاستبدال بنسخة مجددة
    metadata            jsonb NOT NULL DEFAULT '{}',
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (issue_date IS NULL OR issue_date <= expiry_date)
);
CREATE INDEX idx_compliance_items_org_expiry ON compliance_items(org_id, expiry_date) WHERE archived_at IS NULL;
CREATE TRIGGER trg_compliance_items_updated BEFORE UPDATE ON compliance_items
    FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ---------------------------------------------------------------------
-- 5. السياسات الداخلية
--    status يحمل فقط ما لا يُشتق من التاريخ (ساري/ملغى). "تحتاج مراجعة" تُشتق.
-- ---------------------------------------------------------------------
CREATE TABLE internal_policies (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    policy_type         varchar(30) NOT NULL
        CHECK (policy_type IN ('PRIVACY_POLICY','CONFLICT_OF_INTEREST','WHISTLEBLOWING','CODE_OF_CONDUCT','DATA_RETENTION','INFOSEC','OTHER')),
    title               varchar(255) NOT NULL,
    version             varchar(20) NOT NULL DEFAULT '1.0',
    approval_date       date,
    review_due_date     date NOT NULL,
    status              varchar(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('DRAFT','ACTIVE','OBSOLETE')),
    file_object_key     text,
    last_audit_id       uuid,                        -- آخر تدقيق ذكاء اصطناعي (FK يُضاف بعد contract_audits)
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_internal_policies_org_review ON internal_policies(org_id, review_due_date) WHERE status = 'ACTIVE';
CREATE TRIGGER trg_internal_policies_updated BEFORE UPDATE ON internal_policies
    FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ---------------------------------------------------------------------
-- 6. قواعد التنبيه + سجل الإرسال
--    القاعدة تُعرَّف على مستوى المنشأة لنوع الهدف (افتراضي) أو لعنصر بعينه (تخصيص).
--    تغطي عناصر الامتثال والسياسات معاً (كان الربط بالسياسات مفقوداً في 1.0).
-- ---------------------------------------------------------------------
CREATE TABLE alert_rules (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    target_type         varchar(20) NOT NULL CHECK (target_type IN ('COMPLIANCE_ITEM','POLICY')),
    target_id           uuid,                        -- NULL = القاعدة الافتراضية لكل أهداف هذا النوع
    days_before         int[] NOT NULL DEFAULT ARRAY[60,30,14,7,3,1,0],
    channels            text[] NOT NULL DEFAULT ARRAY['WHATSAPP','EMAIL'],
    is_enabled          boolean NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (0 <= ALL(days_before))
);
CREATE UNIQUE INDEX uq_alert_rules_default ON alert_rules(org_id, target_type) WHERE target_id IS NULL;
CREATE UNIQUE INDEX uq_alert_rules_target  ON alert_rules(org_id, target_type, target_id) WHERE target_id IS NOT NULL;

CREATE TABLE alert_dispatches (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    target_type         varchar(20) NOT NULL CHECK (target_type IN ('COMPLIANCE_ITEM','POLICY')),
    target_id           uuid NOT NULL,
    due_date            date NOT NULL,               -- تاريخ الانتهاء/المراجعة وقت التخطيط (يتغير بعد التجديد)
    threshold_days      int  NOT NULL,               -- العتبة التي أطلقت التنبيه (60, 30, ... 0)
    channel             varchar(10) NOT NULL CHECK (channel IN ('WHATSAPP','EMAIL')),
    recipient_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
    recipient_address   varchar(255) NOT NULL,       -- رقم أو بريد وقت الإرسال
    status              varchar(12) NOT NULL DEFAULT 'QUEUED'
        CHECK (status IN ('QUEUED','SENDING','SENT','DELIVERED','READ','FAILED','SKIPPED','CANCELED')),
    skip_reason         text,
    scheduled_for       timestamptz NOT NULL,        -- يُخطَّط ليلاً ويُرسَل في ساعات النهار
    attempts            smallint NOT NULL DEFAULT 0,
    provider            varchar(20),                 -- 'UNIFONIC', 'META', 'SES'
    provider_message_id varchar(255),
    last_error          text,
    sent_at             timestamptz,
    delivered_at        timestamptz,
    payload             jsonb,                       -- متغيرات القالب المرسلة
    created_at          timestamptz NOT NULL DEFAULT now(),
    -- يمنع التكرار: نفس الهدف + نفس تاريخ الاستحقاق + نفس العتبة + نفس القناة + نفس المستلم.
    -- بعد التجديد يتغير due_date فتبدأ دورة تنبيهات جديدة تلقائياً.
    UNIQUE (target_type, target_id, due_date, threshold_days, channel, recipient_address)
);
CREATE INDEX idx_alert_dispatches_queue ON alert_dispatches(scheduled_for) WHERE status = 'QUEUED';
CREATE INDEX idx_alert_dispatches_org ON alert_dispatches(org_id, created_at DESC);
CREATE INDEX idx_alert_dispatches_provider_msg ON alert_dispatches(provider_message_id) WHERE provider_message_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 7. الحوكمة: قرارات الشركاء والمجالس
-- ---------------------------------------------------------------------
CREATE TABLE governance_resolutions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    title               varchar(255) NOT NULL,
    resolution_type     varchar(30) NOT NULL
        CHECK (resolution_type IN ('ORDINARY_ASSEMBLY','EXTRAORDINARY_ASSEMBLY','BOARD_DECISION','PARTNERS_DECISION','MANAGER_DECISION')),
    meeting_date        date NOT NULL,
    status              varchar(20) NOT NULL DEFAULT 'DRAFTED'
        CHECK (status IN ('DRAFTED','CIRCULATED','SIGNED','ARCHIVED')),
    quorum_met          boolean,
    voting_summary      jsonb,                       -- [{member, shares_pct, vote}]
    document_object_key text,
    created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_governance_resolutions_org ON governance_resolutions(org_id, meeting_date DESC);
CREATE TRIGGER trg_governance_resolutions_updated BEFORE UPDATE ON governance_resolutions
    FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ---------------------------------------------------------------------
-- 8. مصفوفة الصلاحيات وتفويض السلطات (DoA) — جديد في 1.1
-- ---------------------------------------------------------------------
CREATE TABLE authority_matrix (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    transaction_type    varchar(50) NOT NULL,        -- 'PAYMENT','PURCHASE_ORDER','HIRING','CONTRACT_SIGNING','BANK_ACCOUNT',...
    description         text,
    approver_title      varchar(100) NOT NULL,       -- المسمى (المدير العام، الشريك المدير...)
    approver_membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL,
    limit_amount_sar    numeric(14,2),               -- NULL = بلا سقف
    requires_dual_signature boolean NOT NULL DEFAULT false,
    source_resolution_id uuid REFERENCES governance_resolutions(id) ON DELETE SET NULL, -- القرار الذي منح التفويض
    effective_from      date NOT NULL,
    effective_to        date,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX idx_authority_matrix_org ON authority_matrix(org_id, transaction_type);

-- ---------------------------------------------------------------------
-- 9. سجل أنشطة معالجة البيانات الشخصية (RoPA)
-- ---------------------------------------------------------------------
CREATE TABLE pdpl_data_records (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    activity_name       varchar(255) NOT NULL,
    purpose             text NOT NULL,               -- الغرض الصريح من المعالجة
    data_subjects       varchar(20) NOT NULL
        CHECK (data_subjects IN ('EMPLOYEES','CUSTOMERS','VENDORS','APPLICANTS','VISITORS','OTHER')),
    data_categories     jsonb NOT NULL,              -- ["الهوية الوطنية","الحساب البنكي"]
    includes_sensitive_data boolean NOT NULL DEFAULT false, -- صحية، ائتمانية، ...
    legal_basis         varchar(30) NOT NULL
        CHECK (legal_basis IN ('CONSENT','CONTRACTUAL','LEGAL_OBLIGATION','VITAL_INTEREST','PUBLIC_INTEREST','LEGITIMATE_INTEREST')),
    owner_membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL, -- المسؤول عن النشاط
    retention_period_months int NOT NULL CHECK (retention_period_months > 0),
    storage_location    varchar(30) NOT NULL
        CHECK (storage_location IN ('SAUDI_LOCAL_CLOUD','ON_PREMISE','FOREIGN_CLOUD')),
    cross_border_transfer boolean NOT NULL DEFAULT false,
    transfer_destination text,                       -- الدولة/الجهة عند النقل خارج المملكة
    transfer_safeguard  text,                        -- الأساس النظامي للنقل
    processors          jsonb NOT NULL DEFAULT '[]', -- المعالجون من الأطراف الثالثة
    security_controls   text,
    next_review_date    date,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    -- النقل خارج المملكة يستلزم توثيق الوجهة والأساس.
    CHECK (NOT cross_border_transfer OR (transfer_destination IS NOT NULL AND transfer_safeguard IS NOT NULL))
);
CREATE INDEX idx_pdpl_data_records_org ON pdpl_data_records(org_id);
CREATE TRIGGER trg_pdpl_data_records_updated BEFORE UPDATE ON pdpl_data_records
    FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ---------------------------------------------------------------------
-- 10. تقييم الأثر على الخصوصية (DPIA) — جديد في 1.1
-- ---------------------------------------------------------------------
CREATE TABLE dpia_assessments (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_name        varchar(255) NOT NULL,
    related_record_id   uuid REFERENCES pdpl_data_records(id) ON DELETE SET NULL,
    questionnaire_version varchar(20) NOT NULL DEFAULT '1.0',
    answers             jsonb NOT NULL DEFAULT '{}',
    risk_score          smallint CHECK (risk_score BETWEEN 0 AND 100),
    risk_level          varchar(10) CHECK (risk_level IN ('LOW','MEDIUM','HIGH','CRITICAL')),
    mitigations         jsonb NOT NULL DEFAULT '[]',
    status              varchar(20) NOT NULL DEFAULT 'IN_PROGRESS'
        CHECK (status IN ('IN_PROGRESS','COMPLETED','APPROVED')),
    completed_at        timestamptz,
    created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dpia_assessments_org ON dpia_assessments(org_id);
CREATE TRIGGER trg_dpia_assessments_updated BEFORE UPDATE ON dpia_assessments
    FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ---------------------------------------------------------------------
-- 11. تدقيق العقود والسياسات بالذكاء الاصطناعي
--     يوثّق أين عولجت الوثيقة (المزوّد والمنطقة) وهل حُجبت البيانات الشخصية قبل الإرسال.
-- ---------------------------------------------------------------------
CREATE TABLE contract_audits (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    audit_category      varchar(30) NOT NULL
        CHECK (audit_category IN ('LABOR_CONTRACT','PDPL_PRIVACY_POLICY','VENDOR_AGREEMENT','INTERNAL_POLICY')),
    file_name           varchar(255) NOT NULL,
    file_object_key     text NOT NULL,
    file_sha256         char(64) NOT NULL,
    status              varchar(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','PROCESSING','COMPLETED','FAILED')),
    verdict             varchar(30) CHECK (verdict IN ('COMPLIANT','CONTAINS_VIOLATIONS','HIGH_RISK')),
    compliance_percentage smallint CHECK (compliance_percentage BETWEEN 0 AND 100),
    findings            jsonb,
    pii_redacted        boolean NOT NULL DEFAULT false,
    model_provider      varchar(50),
    model_name          varchar(100),
    model_region        varchar(50),                 -- مثل 'me-central-2' — لإثبات مكان المعالجة
    knowledge_snapshot  jsonb,                       -- معرّفات المواد النظامية المسترجعة (للتتبع)
    error               text,
    retain_until        date,                        -- حذف الملف الأصلي بعد هذا التاريخ
    requested_by        uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    completed_at        timestamptz
);
CREATE INDEX idx_contract_audits_org_month ON contract_audits(org_id, created_at DESC);

ALTER TABLE internal_policies
    ADD CONSTRAINT fk_internal_policies_last_audit
    FOREIGN KEY (last_audit_id) REFERENCES contract_audits(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- 12. سجل استهلاك الذكاء الاصطناعي والتكلفة
-- ---------------------------------------------------------------------
CREATE TABLE ai_usage_ledger (
    id                  bigserial PRIMARY KEY,
    org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    feature             varchar(30) NOT NULL,        -- 'CONTRACT_AUDIT','PRIVACY_AUDIT','EMBEDDING','DPIA_ASSIST'
    audit_id            uuid REFERENCES contract_audits(id) ON DELETE SET NULL,
    provider            varchar(50) NOT NULL,
    model               varchar(100) NOT NULL,
    input_tokens        int NOT NULL DEFAULT 0,
    output_tokens       int NOT NULL DEFAULT 0,
    cost_sar            numeric(12,4) NOT NULL DEFAULT 0,
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_usage_ledger_org_time ON ai_usage_ledger(org_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 13. قاعدة المعرفة النظامية (RAG) — عامة لكل المنشآت، بلا org_id
-- ---------------------------------------------------------------------
CREATE TABLE regulatory_sources (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    authority           varchar(30) NOT NULL
        CHECK (authority IN ('LABOR_LAW','LABOR_LAW_REGS','PDPL','PDPL_REGS','COMPANIES_LAW','CHI','BALADY','ZATCA','GOSI','HRSD_DECISION','OTHER')),
    title               varchar(255) NOT NULL,
    version_label       varchar(50),                 -- مثل 'تعديلات 1446هـ'
    effective_date      date,
    source_url          text,
    is_active           boolean NOT NULL DEFAULT true, -- النسخ الملغاة تبقى للتتبع ولا تُسترجع
    uploaded_by         uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE regulatory_knowledge (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id           uuid NOT NULL REFERENCES regulatory_sources(id) ON DELETE CASCADE,
    article_number      varchar(50),
    title               varchar(255),
    content_chunk       text NOT NULL,
    content_sha256      char(64) NOT NULL,           -- لتفادي إعادة التضمين لنص لم يتغير
    embedding           vector(1024),                -- البعد يتبع نموذج التضمين المعتمد (انظر الوثيقة §4)
    embedding_model     varchar(100),
    embedded_at         timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_id, content_sha256)
);
CREATE INDEX idx_regulatory_knowledge_embedding
    ON regulatory_knowledge USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_regulatory_knowledge_article ON regulatory_knowledge(source_id, article_number);

-- ---------------------------------------------------------------------
-- 14. سجل التدقيق (من فعل ماذا) — منصة امتثال يجب أن تكون قابلة للتدقيق
-- ---------------------------------------------------------------------
CREATE TABLE audit_log (
    id                  bigserial PRIMARY KEY,
    org_id              uuid REFERENCES organizations(id) ON DELETE CASCADE, -- NULL للأحداث على مستوى المنصة
    actor_user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
    action              varchar(50) NOT NULL,        -- 'CREATE','UPDATE','DELETE','LOGIN','EXPORT',...
    entity_type         varchar(50) NOT NULL,
    entity_id           uuid,
    changes             jsonb,
    ip_address          inet,
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_log_org_time ON audit_log(org_id, created_at DESC);

-- =====================================================================
-- العروض المشتقة
-- =====================================================================

-- حالة العنصر محسوبة بتوقيت الرياض، لا تتقادم أبداً.
CREATE VIEW v_compliance_items WITH (security_invoker = true) AS
SELECT ci.*,
       (ci.expiry_date - app.today_riyadh()) AS days_remaining,
       CASE
           WHEN ci.expiry_date <  app.today_riyadh()       THEN 'EXPIRED'
           WHEN ci.expiry_date <= app.today_riyadh() + 30  THEN 'EXPIRING_SOON'
           ELSE 'ACTIVE'
       END AS status,
       (ci.expiry_date <= app.today_riyadh() + 15) AS action_required
FROM compliance_items ci
WHERE ci.archived_at IS NULL;

CREATE VIEW v_internal_policies WITH (security_invoker = true) AS
SELECT p.*,
       (p.review_due_date - app.today_riyadh()) AS days_remaining,
       CASE
           WHEN p.status <> 'ACTIVE'                         THEN p.status
           WHEN p.review_due_date <  app.today_riyadh()      THEN 'OVERDUE_REVIEW'
           WHEN p.review_due_date <= app.today_riyadh() + 30 THEN 'NEEDS_REVIEW'
           ELSE 'ACTIVE'
       END AS effective_status
FROM internal_policies p;

-- استهلاك الشهر الحالي لكل منشأة (لفرض حصة الباقة).
CREATE VIEW v_monthly_ai_usage WITH (security_invoker = true) AS
SELECT org_id,
       date_trunc('month', created_at AT TIME ZONE 'Asia/Riyadh')::date AS month,
       count(*) FILTER (WHERE status <> 'FAILED') AS audits_count
FROM contract_audits
GROUP BY 1, 2;

-- =====================================================================
-- عزل المستأجرين: Row-Level Security
-- =====================================================================

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'memberships','subscriptions','compliance_items','internal_policies',
        'alert_rules','alert_dispatches','governance_resolutions','authority_matrix',
        'pdpl_data_records','dpia_assessments','contract_audits','ai_usage_ledger','audit_log'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING (org_id = app.current_org_id()) WITH CHECK (org_id = app.current_org_id())', t);
    END LOOP;
END $$;

-- المنشأة نفسها: يرى المستأجر صفّه فقط.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organizations
    USING (id = app.current_org_id()) WITH CHECK (id = app.current_org_id());

-- المستخدمون: يرى المستأجر نفسه وأعضاء منشأته الحالية فقط، ويعدّل نفسه فقط.
-- (تسجيل الدخول يتم عبر دور المنصة لأنه يسبق تحديد المنشأة.)
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_visible ON users FOR SELECT USING (
    id = app.current_user_id()
    OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id)  -- memberships مقيّدة بالمنشأة الحالية عبر RLS
);
CREATE POLICY users_self_update ON users FOR UPDATE
    USING (id = app.current_user_id()) WITH CHECK (id = app.current_user_id());
CREATE POLICY users_insert ON users FOR INSERT WITH CHECK (true); -- دعوة عضو جديد من مدير المنشأة

-- =====================================================================
-- أدوار قاعدة البيانات
--   haseef_app      : خادم واجهة العملاء — خاضع لـ RLS.
--   haseef_platform : لوحة الإدارة وعمّال Celery — يتجاوز RLS (BYPASSRLS).
-- كلمات المرور تُضبط خارج الـ migration (ALTER ROLE ... PASSWORD).
-- =====================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'haseef_app') THEN
        CREATE ROLE haseef_app LOGIN NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'haseef_platform') THEN
        CREATE ROLE haseef_platform LOGIN BYPASSRLS;
    END IF;
END $$;

GRANT USAGE ON SCHEMA public, app TO haseef_app, haseef_platform;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO haseef_app, haseef_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO haseef_app, haseef_platform;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO haseef_app, haseef_platform;

-- الجداول العامة: العميل يقرأ فقط.
REVOKE INSERT, UPDATE, DELETE ON plans, regulatory_sources, regulatory_knowledge FROM haseef_app;
-- المستخدمون: لا RLS (هوية عامة)، لكن العميل لا يحذف مستخدمين ولا يرفع نفسه لمدير منصة.
REVOKE DELETE ON users FROM haseef_app;
-- (سحب صلاحية عمود واحد لا يُلغي منحاً على مستوى الجدول؛ لذا نمنح أعمدة محددة فقط.)
REVOKE UPDATE ON users FROM haseef_app;
GRANT UPDATE (phone_number, full_name, password_hash, last_login_at) ON users TO haseef_app;
-- سجل التدقيق: إضافة فقط.
REVOKE UPDATE, DELETE ON audit_log FROM haseef_app;

-- =====================================================================
-- بيانات مرجعية: الباقات
-- =====================================================================
INSERT INTO plans (tier, name_ar, monthly_price_sar, yearly_price_sar, features, monthly_ai_audits, monthly_whatsapp_alerts) VALUES
 ('ESSENTIAL',        'باقة الأساس',          199,  1990,  ARRAY['OPERATIONAL','CONTRACTS'],                       3,   200),
 ('PROFESSIONAL_GRC', 'باقة الحوكمة والنمو',  499,  4990,  ARRAY['OPERATIONAL','CONTRACTS','GOVERNANCE','PDPL'],   15,  1000),
 ('ENTERPRISE',       'باقة كبار العملاء',    1299, 12990, ARRAY['OPERATIONAL','CONTRACTS','GOVERNANCE','PDPL','MULTI_ENTITY','BOARD_REPORTS'], NULL, NULL);
