-- 0017: النمو والتشغيل
--   1) التسجيل الذاتي بتجربة 14 يوماً وتحقق البريد ومعالج الإعداد
--   2) الدفع الإلكتروني من العميل (نوايا دفع تتحقق منها المنصة لدى البوابة قبل الاعتماد)
--   3) تقويم الزكاة والضريبة (إقرار القيمة المضافة، الاستقطاع، الزكاة) مع التنبيهات
--   4) رابط تقويم سري (ICS) لمزامنة المواعيد مع تقويم جوجل وأوتلوك والآيفون
--   5) بوت واتساب للموظفين: أعضاء، أسئلة شائعة، سياسات مشتركة، إقرارات، سجل محادثات
--   6) الإضافات المدفوعة (بوت الواتساب) بسعر يُعدَّل من غرفة العمليات

-- ---------------------------------------------------------------- 1) التسجيل الذاتي
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
UPDATE users SET email_verified_at = created_at;           -- الحسابات القائمة أنشأها فريق حصيف فهي موثقة
ALTER TABLE organizations ADD COLUMN onboarded_at timestamptz, ADD COLUMN signup_source varchar(20) NOT NULL DEFAULT 'ADMIN'
    CHECK (signup_source IN ('ADMIN','SELF'));
UPDATE organizations SET onboarded_at = created_at;

CREATE TABLE email_verifications (
    token_hash  char(64) PRIMARY KEY,                      -- sha256 للرمز؛ الرمز نفسه لا يُخزَّن
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_email_verifications_user ON email_verifications(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON email_verifications TO haseef_platform;

-- ---------------------------------------------------------------- 6) الإضافات
CREATE TABLE addon_catalog (
    code            varchar(20) PRIMARY KEY,
    name            varchar(100) NOT NULL,
    monthly_price   numeric(10,2) NOT NULL CHECK (monthly_price >= 0),
    included_tiers  text[] NOT NULL DEFAULT '{}',         -- باقات تشمل الإضافة مجاناً
    limits          jsonb NOT NULL DEFAULT '{}',
    is_active       boolean NOT NULL DEFAULT true,
    updated_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO addon_catalog (code, name, monthly_price, included_tiers, limits) VALUES
 ('WA_BOT', 'بوت واتساب للموظفين', 99, '{ENTERPRISE}', '{"members": 50, "questions": 1000, "extra_members_block": 50, "extra_block_price": 49, "included_unlimited": true}');
GRANT SELECT ON addon_catalog TO haseef_app;
GRANT SELECT, INSERT, UPDATE ON addon_catalog TO haseef_platform;

CREATE TABLE org_addons (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code            varchar(20) NOT NULL REFERENCES addon_catalog(code),
    status          varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELED')),
    paid_until      timestamptz NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, code)
);
ALTER TABLE org_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_addons FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON org_addons FOR SELECT USING (org_id = app.current_org_id());
GRANT SELECT ON org_addons TO haseef_app;                  -- التفعيل بالدفع فقط (دور المنصة)
GRANT SELECT, INSERT, UPDATE, DELETE ON org_addons TO haseef_platform;

-- ---------------------------------------------------------------- 2) الدفع الإلكتروني
CREATE TABLE payment_intents (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    purpose         varchar(15) NOT NULL CHECK (purpose IN ('SUBSCRIPTION','INSTALLMENT','ADDON')),
    plan_tier       varchar(30) REFERENCES plans(tier),
    billing_cycle   varchar(10) CHECK (billing_cycle IN ('MONTHLY','YEARLY')),
    installment_id  uuid REFERENCES plan_installments(id) ON DELETE SET NULL,
    addon_code      varchar(20) REFERENCES addon_catalog(code),
    description     text NOT NULL,
    amount_net      numeric(12,2) NOT NULL CHECK (amount_net > 0),
    vat_amount      numeric(12,2) NOT NULL DEFAULT 0,
    total           numeric(12,2) NOT NULL CHECK (total > 0),
    provider        varchar(15) NOT NULL,
    provider_ref    varchar(100),
    checkout_url    text,
    status          varchar(10) NOT NULL DEFAULT 'INITIATED' CHECK (status IN ('INITIATED','PAID','FAILED','EXPIRED')),
    invoice_id      uuid REFERENCES invoices(id),
    created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    paid_at         timestamptz,
    CHECK (status <> 'PAID' OR paid_at IS NOT NULL)
);
CREATE UNIQUE INDEX uq_payment_intents_provider_ref ON payment_intents(provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX idx_payment_intents_org ON payment_intents(org_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON payment_intents TO haseef_platform;

-- ---------------------------------------------------------------- 3) الزكاة والضريبة
CREATE TABLE tax_profiles (
    org_id                  uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    vat_registered          boolean NOT NULL DEFAULT false,
    vat_frequency           varchar(10) NOT NULL DEFAULT 'QUARTERLY' CHECK (vat_frequency IN ('MONTHLY','QUARTERLY')),
    withholding_applies     boolean NOT NULL DEFAULT false,      -- مدفوعات لغير مقيمين
    zakat_applies           boolean NOT NULL DEFAULT true,
    fiscal_year_end_month   smallint NOT NULL DEFAULT 12 CHECK (fiscal_year_end_month BETWEEN 1 AND 12),
    updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tax_tasks (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    kind            varchar(15) NOT NULL CHECK (kind IN ('VAT_RETURN','WHT_RETURN','ZAKAT_RETURN')),
    period_start    date NOT NULL,
    period_end      date NOT NULL,
    due_date        date NOT NULL,
    amount          numeric(14,2),
    done_at         timestamptz,
    reference       varchar(100),
    done_by         uuid REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (org_id, kind, period_start),
    CHECK (period_end >= period_start)
);
CREATE INDEX idx_tax_tasks_open ON tax_tasks(org_id, due_date) WHERE done_at IS NULL;

-- ---------------------------------------------------------------- 4) رابط التقويم
CREATE TABLE calendar_feeds (
    org_id          uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    token_hash      char(64) NOT NULL UNIQUE,
    include_people  boolean NOT NULL DEFAULT false,            -- أسماء الموظفين لا تخرج إلى تقويمات خارجية افتراضياً
    created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- 5) بوت الموظفين
ALTER TABLE internal_policies ADD COLUMN shared_with_employees boolean NOT NULL DEFAULT false,
                              ADD COLUMN employee_summary text;          -- ملخص يرسله البوت (اختياري)
CREATE TABLE bot_settings (
    org_id          uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    enabled         boolean NOT NULL DEFAULT true,
    invite_code     varchar(12) NOT NULL UNIQUE,
    welcome_text    text,
    hr_contact      varchar(150),
    require_approval boolean NOT NULL DEFAULT true,
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bot_members (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    employee_id     uuid REFERENCES org_employees(id) ON DELETE SET NULL,
    full_name       varchar(150) NOT NULL,
    phone           varchar(20) NOT NULL CHECK (phone ~ '^\+9665\d{8}$'),
    status          varchar(10) NOT NULL DEFAULT 'INVITED' CHECK (status IN ('INVITED','PENDING','ACTIVE','REMOVED')),
    joined_via      varchar(10) NOT NULL DEFAULT 'INVITE' CHECK (joined_via IN ('INVITE','CODE')),
    consent_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CHECK (status <> 'ACTIVE' OR consent_at IS NOT NULL)
);
-- رقم الجوال لا ينتمي لأكثر من منشأة في وقت واحد (البوت يعرف المنشأة من الرقم)
CREATE UNIQUE INDEX uq_bot_members_phone ON bot_members(phone) WHERE status <> 'REMOVED';
CREATE TABLE bot_faqs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    question        varchar(300) NOT NULL,
    answer          text NOT NULL,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bot_messages (
    id              bigserial PRIMARY KEY,
    org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    member_id       uuid REFERENCES bot_members(id) ON DELETE SET NULL,
    direction       char(3) NOT NULL CHECK (direction IN ('IN','OUT')),
    body            text NOT NULL,
    intent          varchar(20),
    sources         jsonb,
    simulated       boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bot_messages_org ON bot_messages(org_id, created_at DESC);
CREATE TABLE policy_acknowledgments (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    policy_id       uuid NOT NULL REFERENCES internal_policies(id) ON DELETE CASCADE,
    member_id       uuid NOT NULL REFERENCES bot_members(id) ON DELETE CASCADE,
    policy_version  varchar(20) NOT NULL,
    channel         varchar(10) NOT NULL DEFAULT 'WHATSAPP',
    acknowledged_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (policy_id, member_id, policy_version)
);

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['tax_profiles','tax_tasks','calendar_feeds','bot_settings','bot_members','bot_faqs','bot_messages','policy_acknowledgments'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app.current_org_id()) WITH CHECK (org_id = app.current_org_id())', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO haseef_app, haseef_platform', t);
    END LOOP;
END $$;
GRANT USAGE ON SEQUENCE bot_messages_id_seq TO haseef_app, haseef_platform;

-- ---------------------------------------------------------------- تنبيهات الضريبة
ALTER TABLE alert_rules DROP CONSTRAINT alert_rules_target_type_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_target_type_check
    CHECK (target_type IN ('COMPLIANCE_ITEM','POLICY','EMPLOYEE_DOC','LABOR_TASK','TAX_TASK'));
ALTER TABLE alert_dispatches DROP CONSTRAINT alert_dispatches_target_type_check;
ALTER TABLE alert_dispatches ADD CONSTRAINT alert_dispatches_target_type_check
    CHECK (target_type IN ('COMPLIANCE_ITEM','POLICY','IQAMA','WORK_PERMIT','CONTRACT_END','PROBATION_END','LABOR_TASK','TAX_TASK'));

CREATE OR REPLACE VIEW v_alert_targets WITH (security_invoker = true) AS
SELECT 'COMPLIANCE_ITEM'::varchar(20)                                AS target_type,
       ci.id                                                         AS target_id,
       ci.org_id,
       ci.title,
       ci.expiry_date                                                AS due_date,
       ci.renewal_url                                                AS link,
       COALESCE(rs.days_before, rd.days_before, ARRAY[60,30,14,7,3,1,0]) AS thresholds,
       COALESCE(rs.channels,    rd.channels,    ARRAY['WHATSAPP','EMAIL']) AS channels,
       COALESCE(rs.is_enabled,  rd.is_enabled,  true)                AS enabled
FROM compliance_items ci
LEFT JOIN alert_rules rs ON rs.target_type = 'COMPLIANCE_ITEM' AND rs.target_id = ci.id
LEFT JOIN alert_rules rd ON rd.target_type = 'COMPLIANCE_ITEM' AND rd.target_id IS NULL AND rd.org_id = ci.org_id
WHERE ci.archived_at IS NULL
UNION ALL
SELECT 'POLICY', p.id, p.org_id, p.title, p.review_due_date, NULL,
       COALESCE(rs.days_before, rd.days_before, ARRAY[30,14,7,0]),
       COALESCE(rs.channels,    rd.channels,    ARRAY['EMAIL','WHATSAPP']),
       COALESCE(rs.is_enabled,  rd.is_enabled,  true)
FROM internal_policies p
LEFT JOIN alert_rules rs ON rs.target_type = 'POLICY' AND rs.target_id = p.id
LEFT JOIN alert_rules rd ON rd.target_type = 'POLICY' AND rd.target_id IS NULL AND rd.org_id = p.org_id
WHERE p.status = 'ACTIVE'
UNION ALL
-- وثائق الموظفين: الإقامة ورخصة العمل ونهاية العقد ونهاية التجربة (قاعدة EMPLOYEE_DOC الافتراضية للمنشأة)
SELECT d.kind::varchar(20), e.id, e.org_id, (d.label || ' — ' || e.full_name)::varchar(255), d.due, NULL,
       COALESCE(rd.days_before, d.thresholds),
       COALESCE(rd.channels, ARRAY['WHATSAPP','EMAIL']),
       COALESCE(rd.is_enabled, true)
FROM org_employees e
CROSS JOIN LATERAL (VALUES
    ('IQAMA',         'انتهاء الإقامة',      e.iqama_expiry,       ARRAY[60,30,14,7,3,1,0]),
    ('WORK_PERMIT',   'انتهاء رخصة العمل',   e.work_permit_expiry, ARRAY[60,30,14,7,3,1,0]),
    ('CONTRACT_END',  'انتهاء عقد العمل',    e.contract_end_date,  ARRAY[60,30,14,7,0]),
    ('PROBATION_END', 'انتهاء فترة التجربة', e.probation_end_date, ARRAY[14,7,0])
) AS d(kind, label, due, thresholds)
LEFT JOIN alert_rules rd ON rd.target_type = 'EMPLOYEE_DOC' AND rd.target_id IS NULL AND rd.org_id = e.org_id
WHERE e.is_active AND d.due IS NOT NULL
UNION ALL
-- المهام الشهرية غير المنجزة: قبل 5 أيام، وقبل يوم، ويوم الاستحقاق
SELECT 'LABOR_TASK', t.id, t.org_id,
       (CASE t.kind WHEN 'GOSI_PAYMENT' THEN 'سداد اشتراكات التأمينات الاجتماعية لشهر '
                   WHEN 'WPS_UPLOAD' THEN 'رفع ملف حماية الأجور في مُدد لشهر '
                   ELSE 'صرف رواتب شهر ' END || to_char(t.period, 'MM/YYYY'))::varchar(255),
       t.due_date, NULL,
       COALESCE(rd.days_before, ARRAY[5,1,0]),
       COALESCE(rd.channels, ARRAY['WHATSAPP','EMAIL']),
       COALESCE(rd.is_enabled, true)
FROM labor_tasks t
LEFT JOIN alert_rules rd ON rd.target_type = 'LABOR_TASK' AND rd.target_id IS NULL AND rd.org_id = t.org_id
WHERE t.done_at IS NULL
UNION ALL
-- الإقرارات الضريبية والزكوية غير المنجزة: قبل 10 أيام، و3، ويوم، ويوم الاستحقاق
SELECT 'TAX_TASK', x.id, x.org_id,
       (CASE x.kind WHEN 'VAT_RETURN' THEN 'إقرار ضريبة القيمة المضافة عن '
                    WHEN 'WHT_RETURN' THEN 'إقرار ضريبة الاستقطاع عن '
                    ELSE 'الإقرار الزكوي عن السنة المنتهية ' END
        || CASE WHEN x.kind = 'ZAKAT_RETURN' THEN to_char(x.period_end, 'MM/YYYY')
                WHEN date_trunc('month', x.period_start) = date_trunc('month', x.period_end) THEN to_char(x.period_start, 'MM/YYYY')
                ELSE to_char(x.period_start, 'MM') || '–' || to_char(x.period_end, 'MM/YYYY') END)::varchar(255),
       x.due_date, 'https://zatca.gov.sa',
       COALESCE(rd.days_before, ARRAY[10,3,1,0]),
       COALESCE(rd.channels, ARRAY['WHATSAPP','EMAIL']),
       COALESCE(rd.is_enabled, true)
FROM tax_tasks x
LEFT JOIN alert_rules rd ON rd.target_type = 'TAX_TASK' AND rd.target_id IS NULL AND rd.org_id = x.org_id
WHERE x.done_at IS NULL;

GRANT SELECT ON v_alert_targets TO haseef_app, haseef_platform;
