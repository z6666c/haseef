-- 0015: العمل والموظفين — التأمينات الاجتماعية، وحماية الأجور (مُدد)، وقوى.
--   * سجل موظفين مختصر (لا هويات ولا آيبان)، بعزل RLS لكل منشأة.
--   * مهام شهرية تلقائية: سداد التأمينات، رفع ملف الأجور في مُدد، صرف الرواتب.
--   * نسب التأمينات بتواريخ سريان يعدّلها فريق حصيف (لا تُكتب في الكود).
--   * إدخال الإقامات ورخص العمل وانتهاء العقود والتجربة والمهام الشهرية في محرك التنبيهات.

CREATE TABLE org_employees (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    full_name               varchar(150) NOT NULL,
    nationality             varchar(10) NOT NULL CHECK (nationality IN ('SAUDI','NON_SAUDI')),
    job_title               varchar(120),
    start_date              date NOT NULL,
    gosi_system             varchar(10) NOT NULL DEFAULT 'OLD' CHECK (gosi_system IN ('OLD','NEW')),  -- النظام الجديد: أول تسجيل بعد 3 يوليو 2024
    basic_wage              numeric(10,2) NOT NULL CHECK (basic_wage >= 0),
    housing_allowance       numeric(10,2) NOT NULL DEFAULT 0 CHECK (housing_allowance >= 0),
    gosi_registered         boolean NOT NULL DEFAULT false,
    qiwa_contract_documented boolean NOT NULL DEFAULT false,
    contract_end_date       date,
    probation_end_date      date,
    iqama_expiry            date,
    work_permit_expiry      date,
    is_active               boolean NOT NULL DEFAULT true,
    left_on                 date,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CHECK (nationality = 'NON_SAUDI' OR (iqama_expiry IS NULL AND work_permit_expiry IS NULL))
);
CREATE INDEX idx_org_employees_org ON org_employees(org_id) WHERE is_active;

CREATE TABLE labor_profiles (
    org_id          uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    salary_day      smallint NOT NULL DEFAULT 27 CHECK (salary_day BETWEEN 1 AND 28),
    nitaqat_band    varchar(20) CHECK (nitaqat_band IN ('PLATINUM','HIGH_GREEN','MID_GREEN','LOW_GREEN','YELLOW','RED')),
    nitaqat_checked_on date,
    gosi_employer_no varchar(20),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE labor_tasks (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    period          date NOT NULL CHECK (extract(day FROM period) = 1),          -- الشهر الذي تخصه المهمة
    kind            varchar(20) NOT NULL CHECK (kind IN ('GOSI_PAYMENT','WPS_UPLOAD','SALARY_PAYMENT')),
    due_date        date NOT NULL,
    amount          numeric(12,2),
    done_at         timestamptz,
    reference       varchar(100),
    done_by         uuid REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (org_id, period, kind)
);
CREATE INDEX idx_labor_tasks_open ON labor_tasks(org_id, due_date) WHERE done_at IS NULL;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['org_employees','labor_profiles','labor_tasks'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app.current_org_id()) WITH CHECK (org_id = app.current_org_id())', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO haseef_app, haseef_platform', t);
    END LOOP;
END $$;

-- نسب التأمينات: صف لكل نظام وتاريخ سريان (النسب كنسبة مئوية من الأجر الخاضع = الأساسي + السكن)
CREATE TABLE gosi_rates (
    id                  serial PRIMARY KEY,
    system              varchar(10) NOT NULL CHECK (system IN ('OLD','NEW','NON_SAUDI')),
    effective_from      date NOT NULL,
    employee_annuity    numeric(5,2) NOT NULL DEFAULT 0,
    employer_annuity    numeric(5,2) NOT NULL DEFAULT 0,
    employee_saned      numeric(5,2) NOT NULL DEFAULT 0,
    employer_saned      numeric(5,2) NOT NULL DEFAULT 0,
    employer_hazards    numeric(5,2) NOT NULL DEFAULT 0,
    min_base            numeric(10,2) NOT NULL DEFAULT 1500,
    max_base            numeric(10,2) NOT NULL DEFAULT 45000,
    note                text,
    updated_at          timestamptz NOT NULL DEFAULT now(),
    updated_by          uuid REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (system, effective_from)
);
INSERT INTO gosi_rates (system, effective_from, employee_annuity, employer_annuity, employee_saned, employer_saned, employer_hazards, note) VALUES
 ('OLD',       '2014-01-01', 9.00, 9.00, 0.75, 0.75, 2.00, 'المشتركون قبل 3 يوليو 2024'),
 ('NEW',       '2024-07-03', 9.00, 9.00, 0.75, 0.75, 2.00, 'النظام الجديد — السنة الأولى'),
 ('NEW',       '2025-07-01', 9.50, 9.50, 0.75, 0.75, 2.00, 'زيادة تدريجية 0.5%'),
 ('NEW',       '2026-07-01', 10.00, 10.00, 0.75, 0.75, 2.00, 'زيادة تدريجية 0.5%'),
 ('NEW',       '2027-07-01', 10.50, 10.50, 0.75, 0.75, 2.00, 'زيادة تدريجية 0.5%'),
 ('NEW',       '2028-07-01', 11.00, 11.00, 0.75, 0.75, 2.00, 'النسبة النهائية'),
 ('NON_SAUDI', '2014-01-01', 0, 0, 0, 0, 2.00, 'غير السعوديين: الأخطار المهنية على صاحب العمل فقط');
ALTER TABLE gosi_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY gosi_rates_read ON gosi_rates FOR SELECT USING (true);
GRANT SELECT ON gosi_rates TO haseef_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON gosi_rates TO haseef_platform;
GRANT USAGE ON SEQUENCE gosi_rates_id_seq TO haseef_platform;

-- محرك التنبيهات: أنواع أهداف جديدة
ALTER TABLE alert_rules DROP CONSTRAINT alert_rules_target_type_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_target_type_check
    CHECK (target_type IN ('COMPLIANCE_ITEM','POLICY','EMPLOYEE_DOC','LABOR_TASK'));
ALTER TABLE alert_dispatches DROP CONSTRAINT alert_dispatches_target_type_check;
ALTER TABLE alert_dispatches ADD CONSTRAINT alert_dispatches_target_type_check
    CHECK (target_type IN ('COMPLIANCE_ITEM','POLICY','IQAMA','WORK_PERMIT','CONTRACT_END','PROBATION_END','LABOR_TASK'));

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
WHERE t.done_at IS NULL;

GRANT SELECT ON v_alert_targets TO haseef_app, haseef_platform;

-- مصروفات حصيف نفسها: التأمينات الاجتماعية ورسوم قوى/رخص العمل
ALTER TABLE expenses DROP CONSTRAINT expenses_category_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_category_check CHECK (category IN
    ('HOSTING','AI','MESSAGING','PAYMENT_FEES','SALARIES','GOSI','QIWA','LAWYER_FEES',
     'MARKETING','PROFESSIONAL','GOVERNMENT','SOFTWARE','OFFICE','OTHER'));

-- سجل الموظفين والحاسبة ومؤشرات قوى: باقتا الحوكمة وكبار العملاء (التقويم الشهري والتنبيهات لكل الباقات)
UPDATE plans SET features = array_append(features, 'LABOR_HR')
 WHERE tier IN ('PROFESSIONAL_GRC','ENTERPRISE') AND NOT ('LABOR_HR' = ANY(features));
