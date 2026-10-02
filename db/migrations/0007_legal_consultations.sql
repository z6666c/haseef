-- =====================================================================
-- 0007 — الاستشارات القانونية بالساعة مع محامين مرخصين
--   المحامون والتسعيرة يديرها فريق حصيف؛ المنشأة تحجز وتلغي طلبها فقط.
--   السعر يُحسب في الخادم ويُجمَّد في الحجز (لا يتغير إذا تغيّرت التسعيرة لاحقاً).
-- =====================================================================

CREATE TABLE legal_lawyers (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name           varchar(150) NOT NULL,
    license_number      varchar(50) NOT NULL UNIQUE,           -- رقم الترخيص المهني
    specialties         text[] NOT NULL DEFAULT '{}',          -- رموز المجالات
    bio                 text,
    email               citext,
    phone_number        varchar(20),
    is_active           boolean NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE legal_rates (
    topic               varchar(30) PRIMARY KEY,
    title               varchar(150) NOT NULL,
    description         text,
    tier                varchar(12) NOT NULL CHECK (tier IN ('GENERAL','SPECIALIZED')),
    hourly_rate_sar     numeric(10,2) NOT NULL CHECK (hourly_rate_sar > 0),
    is_active           boolean NOT NULL DEFAULT true,
    sort                smallint NOT NULL DEFAULT 100,
    updated_by          uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_at          timestamptz NOT NULL DEFAULT now()
);

-- التسعيرة الأولية (قابلة للتعديل من لوحة التحكم). الأسعار قبل الضريبة.
INSERT INTO legal_rates (topic, title, description, tier, hourly_rate_sar, sort) VALUES
 ('CORPORATE',  'الشركات والحوكمة',           'عقود التأسيس، قرارات الشركاء والمجالس، تعديل الهيكل، المستفيد الحقيقي.', 'GENERAL', 650, 10),
 ('CONTRACTS',  'العقود التجارية',             'مراجعة وصياغة العقود مع العملاء والموردين والمقاولين.',                     'GENERAL', 650, 20),
 ('LABOR',      'العمل والموارد البشرية',       'عقود العمل، لائحة تنظيم العمل، الإنهاء والمخالصات، النزاعات العمالية.',     'GENERAL', 650, 30),
 ('PDPL',       'حماية البيانات الشخصية',       'سياسة الخصوصية، النقل خارج المملكة، حوادث التسرب، عقود المعالجين.',        'GENERAL', 650, 40),
 ('COMPLIANCE', 'التراخيص والامتثال التنظيمي',  'متطلبات الجهات الرقابية، المخالفات والغرامات، التظلمات.',                  'GENERAL', 650, 50),
 ('RESTRUCTURING','إعادة الهيكلة والاندماج',     'التحول بين أنواع الشركات، الاندماج والاستحواذ، دخول مستثمر.',              'SPECIALIZED', 950, 60),
 ('DISPUTES',   'النزاعات والتقاضي والتحكيم',   'تقييم موقف نزاع قائم، الإنذارات، الاستعداد للتقاضي أو التحكيم.',           'SPECIALIZED', 950, 70);

CREATE TABLE legal_consultations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    requested_by        uuid REFERENCES users(id) ON DELETE SET NULL,
    topic               varchar(30) NOT NULL REFERENCES legal_rates(topic),
    subject             varchar(255) NOT NULL,
    details             text,
    duration_minutes    smallint NOT NULL CHECK (duration_minutes IN (30, 60, 90, 120, 180, 240)),
    urgent              boolean NOT NULL DEFAULT false,
    mode                varchar(10) NOT NULL DEFAULT 'VIDEO' CHECK (mode IN ('VIDEO','PHONE','IN_PERSON')),
    preferred_at        timestamptz NOT NULL,
    price               jsonb NOT NULL,                        -- عرض السعر المجمّد وقت الطلب
    total_sar           numeric(10,2) NOT NULL CHECK (total_sar > 0),
    status              varchar(12) NOT NULL DEFAULT 'REQUESTED'
        CHECK (status IN ('REQUESTED','CONFIRMED','COMPLETED','CANCELED')),
    lawyer_id           uuid REFERENCES legal_lawyers(id) ON DELETE SET NULL,
    scheduled_at        timestamptz,
    meeting_link        text,
    payment_status      varchar(10) NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID','PAID','REFUNDED')),
    payment_reference   varchar(100),
    cancel_reason       text,
    lawyer_summary      text,                                  -- ملخص ما بعد الاستشارة (يراه العميل)
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (status <> 'CONFIRMED' OR (lawyer_id IS NOT NULL AND scheduled_at IS NOT NULL)),
    CHECK (payment_status <> 'PAID' OR payment_reference IS NOT NULL)
);
CREATE INDEX idx_legal_consultations_org ON legal_consultations(org_id, created_at DESC);
CREATE INDEX idx_legal_consultations_status ON legal_consultations(status, preferred_at);

ALTER TABLE legal_consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_consultations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_consultations
    USING (org_id = app.current_org_id()) WITH CHECK (org_id = app.current_org_id());
-- المنشأة تنشئ طلبها وتلغيه؛ التأكيد والتعيين والدفع لفريق حصيف
GRANT SELECT, INSERT ON legal_consultations TO haseef_app;
GRANT UPDATE (status, cancel_reason, updated_at) ON legal_consultations TO haseef_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON legal_consultations TO haseef_platform;

-- التسعيرة: العميل يقرأ النشط فقط. المحامون: العميل يرى المحامي المعيّن لحجزه فقط (عبر الخادم، لا مباشرة).
ALTER TABLE legal_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_rates FORCE ROW LEVEL SECURITY;
CREATE POLICY clients_read_active ON legal_rates FOR SELECT TO haseef_app USING (is_active);
REVOKE INSERT, UPDATE, DELETE ON legal_rates FROM haseef_app;
GRANT SELECT ON legal_rates TO haseef_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON legal_rates TO haseef_platform;

ALTER TABLE legal_lawyers ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_lawyers FORCE ROW LEVEL SECURITY;
-- haseef_app يرى المحامي المعيّن لاستشارات منشأته فقط (الاسم والترخيص والتخصص)
CREATE POLICY assigned_only ON legal_lawyers FOR SELECT TO haseef_app
    USING (EXISTS (SELECT 1 FROM legal_consultations c WHERE c.lawyer_id = legal_lawyers.id));
REVOKE INSERT, UPDATE, DELETE ON legal_lawyers FROM haseef_app;
GRANT SELECT (id, full_name, license_number, specialties, bio) ON legal_lawyers TO haseef_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON legal_lawyers TO haseef_platform;

