-- 0019: الموارد البشرية (ضمن إضافة ATTENDANCE) + تقويم المناسبات السنوية
--   * الإجازات: سنوية، اعتيادية، اضطرارية، مرضية (بشرائح المادة 117) — لكل منشأة سياستها (مدفوعة؟ من الرصيد؟ حدود)
--   * طلب الإجازة من رابط الموظف أو البوت أو الموارد البشرية، والمباشرة بعد الإجازة وتأكيدها
--   * إشعارات الخصم للموظف مع حقه في الاعتراض، وضوابط نظام العمل تُتحقق في الخادم
--   * المناسبات السنوية: تديرها المنصة، وتُرسل تهنئة للمشتركين، وكل منشأة تختار الإرسال لموظفيها

UPDATE addon_catalog SET name = 'الحضور والإجازات والخصومات' WHERE code = 'ATTENDANCE';

-- جوال الموظف (اختياري): لإشعارات الإجازات والخصومات والتهاني
ALTER TABLE org_employees ADD COLUMN mobile varchar(20) CHECK (mobile IS NULL OR mobile ~ '^\+9665[0-9]{8}$');

CREATE TABLE hr_settings (
    org_id              uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    count_workdays_only boolean NOT NULL DEFAULT true,         -- تُحسب أيام الإجازة على أيام العمل فقط (دون العطل الأسبوعية والرسمية)
    objection_days      smallint NOT NULL DEFAULT 15 CHECK (objection_days BETWEEN 1 AND 60),
    notify_employees    boolean NOT NULL DEFAULT true,         -- إشعار واتساب للموظف بالقرارات
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hr_leave_policies (
    org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    leave_type          varchar(10) NOT NULL CHECK (leave_type IN ('ANNUAL','REGULAR','EMERGENCY','SICK')),
    is_paid             boolean NOT NULL,
    from_balance        boolean NOT NULL,                      -- تُخصم من رصيد الإجازة السنوية
    max_days_per_request smallint CHECK (max_days_per_request BETWEEN 1 AND 120),
    yearly_cap          smallint CHECK (yearly_cap BETWEEN 1 AND 365),
    min_notice_days     smallint NOT NULL DEFAULT 0 CHECK (min_notice_days BETWEEN 0 AND 90),
    is_active           boolean NOT NULL DEFAULT true,
    PRIMARY KEY (org_id, leave_type)
);
CREATE TABLE leave_requests (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    employee_id         uuid NOT NULL REFERENCES org_employees(id) ON DELETE CASCADE,
    leave_type          varchar(10) NOT NULL CHECK (leave_type IN ('ANNUAL','REGULAR','EMERGENCY','SICK')),
    start_date          date NOT NULL,
    end_date            date NOT NULL,
    days                smallint NOT NULL CHECK (days BETWEEN 0 AND 366),
    reason              varchar(500),
    medical_ref         varchar(60),                           -- رقم التقرير الطبي (منصة صحة) للإجازة المرضية
    attachment_key      varchar(200),                          -- مرفق الإجازة (التقرير الطبي): مسار داخلي في مساحة الملفات، لا يحمل اسم المستخدم
    attachment_name     varchar(200),
    attachment_mime     varchar(60) CHECK (attachment_mime IS NULL OR attachment_mime IN ('application/pdf','image/jpeg','image/png')),
    attachment_size     integer CHECK (attachment_size IS NULL OR attachment_size BETWEEN 1 AND 10485760),
    attachment_at       timestamptz,
    status              varchar(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
    source              varchar(4) NOT NULL CHECK (source IN ('LINK','BOT','HR')),
    decided_by          uuid REFERENCES users(id) ON DELETE SET NULL,
    decided_at          timestamptz,
    decision_note       varchar(500),
    return_date         date,                                  -- تاريخ المباشرة الذي أبلغ به الموظف أو أدخلته الموارد البشرية
    return_submitted_at timestamptz,
    return_confirmed_at timestamptz,
    return_confirmed_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (end_date >= start_date),
    CHECK (return_date IS NULL OR return_date > start_date)
);
CREATE INDEX idx_leave_requests_org ON leave_requests(org_id, start_date DESC);
CREATE INDEX idx_leave_requests_emp ON leave_requests(employee_id, start_date);
CREATE TABLE leave_adjustments (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    employee_id         uuid NOT NULL REFERENCES org_employees(id) ON DELETE CASCADE,
    year                smallint NOT NULL CHECK (year BETWEEN 2000 AND 2100),
    days                numeric(5,1) NOT NULL CHECK (days BETWEEN -365 AND 365),   -- رصيد مرحّل أو تصحيح
    note                varchar(300) NOT NULL,
    created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE deduction_notices (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    employee_id         uuid NOT NULL REFERENCES org_employees(id) ON DELETE CASCADE,
    kind                varchar(12) NOT NULL CHECK (kind IN ('LATE','ABSENCE','LATE_RETURN','VIOLATION','OTHER')),
    incident_date       date NOT NULL,
    description         varchar(1000) NOT NULL,
    amount              numeric(10,2) NOT NULL CHECK (amount > 0),
    payroll_month       date NOT NULL CHECK (extract(day FROM payroll_month) = 1),
    status              varchar(10) NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED','OBJECTED','CONFIRMED','CANCELLED')),
    seen_at             timestamptz,
    objection_text      varchar(1000),
    objected_at         timestamptz,
    decided_at          timestamptz,
    decided_by          uuid REFERENCES users(id) ON DELETE SET NULL,
    decision_note       varchar(500),
    leave_request_id    uuid REFERENCES leave_requests(id) ON DELETE SET NULL,
    created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_deduction_notices_org ON deduction_notices(org_id, payroll_month DESC);

-- المناسبات السنوية (بيانات منصة، يقرؤها الجميع)
CREATE TABLE annual_events (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code                varchar(30) NOT NULL,
    name                varchar(120) NOT NULL,
    event_date          date NOT NULL,
    kind                varchar(10) NOT NULL CHECK (kind IN ('NATIONAL','RELIGIOUS','OCCASION')),
    is_holiday          boolean NOT NULL DEFAULT false,
    holiday_days        smallint NOT NULL DEFAULT 0 CHECK (holiday_days BETWEEN 0 AND 14),
    greeting            varchar(500) NOT NULL,
    notify_subscribers  boolean NOT NULL DEFAULT true,
    is_active           boolean NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (code, event_date)
);
ALTER TABLE annual_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY annual_events_read ON annual_events FOR SELECT USING (true);
GRANT SELECT ON annual_events TO haseef_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON annual_events TO haseef_platform;

CREATE TABLE org_event_settings (
    org_id              uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    enabled             boolean NOT NULL DEFAULT false,        -- إرسال التهاني لموظفي المنشأة (اختياري)
    signature           varchar(120),
    excluded_codes      text[] NOT NULL DEFAULT '{}',
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE event_sends (
    id                  bigserial PRIMARY KEY,
    org_id              uuid REFERENCES organizations(id) ON DELETE CASCADE,
    event_id            uuid NOT NULL REFERENCES annual_events(id) ON DELETE CASCADE,
    audience            varchar(10) NOT NULL CHECK (audience IN ('SUBSCRIBER','EMPLOYEE')),
    recipient           varchar(20) NOT NULL,
    status              varchar(8) NOT NULL CHECK (status IN ('SENT','FAILED')),
    error               varchar(300),
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (event_id, audience, recipient)
);

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['hr_settings','hr_leave_policies','leave_requests','leave_adjustments','deduction_notices','org_event_settings','event_sends'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app.current_org_id()) WITH CHECK (org_id = app.current_org_id())', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO haseef_app, haseef_platform', t);
    END LOOP;
END $$;
GRANT USAGE ON SEQUENCE event_sends_id_seq TO haseef_app, haseef_platform;

-- المناسبات (تواريخ هجرية وفق تقويم أم القرى، تُراجع من غرفة العمليات عند إعلان الرؤية)
INSERT INTO annual_events (code, name, event_date, kind, is_holiday, holiday_days, greeting) VALUES
 ('FOUNDING_DAY', 'يوم التأسيس', '2027-02-22', 'NATIONAL', true, 1, 'يوم التأسيس.. ثلاثة قرون من المجد والعز. كل عام والوطن بخير.'),
 ('RAMADAN', 'بداية شهر رمضان', '2027-02-08', 'RELIGIOUS', false, 0, 'مبارك عليكم الشهر، تقبّل الله صيامكم وقيامكم.'),
 ('FLAG_DAY', 'يوم العلم', '2027-03-11', 'NATIONAL', false, 0, 'يوم العلم.. راية التوحيد عالية خفّاقة.'),
 ('EID_FITR', 'عيد الفطر', '2027-03-09', 'RELIGIOUS', true, 4, 'عيدكم مبارك، وكل عام وأنتم بخير.'),
 ('ARAFAH', 'يوم عرفة', '2027-05-15', 'RELIGIOUS', false, 0, 'يوم عرفة.. تقبّل الله منا ومنكم صالح الأعمال.'),
 ('EID_ADHA', 'عيد الأضحى', '2027-05-16', 'RELIGIOUS', true, 4, 'عيد أضحى مبارك، أعاده الله علينا وعليكم بالخير.'),
 ('HIJRI_NEW_YEAR', 'رأس السنة الهجرية 1449', '2027-06-06', 'OCCASION', false, 0, 'كل عام هجري وأنتم بخير.'),
 ('NATIONAL_DAY', 'اليوم الوطني السعودي', '2027-09-23', 'NATIONAL', true, 1, 'اليوم الوطني السعودي.. دام عزك يا وطن.'),
 ('RAMADAN', 'بداية شهر رمضان', '2028-01-28', 'RELIGIOUS', false, 0, 'مبارك عليكم الشهر، تقبّل الله صيامكم وقيامكم.'),
 ('FOUNDING_DAY', 'يوم التأسيس', '2028-02-22', 'NATIONAL', true, 1, 'يوم التأسيس.. ثلاثة قرون من المجد والعز. كل عام والوطن بخير.'),
 ('EID_FITR', 'عيد الفطر', '2028-02-26', 'RELIGIOUS', true, 4, 'عيدكم مبارك، وكل عام وأنتم بخير.'),
 ('FLAG_DAY', 'يوم العلم', '2028-03-11', 'NATIONAL', false, 0, 'يوم العلم.. راية التوحيد عالية خفّاقة.'),
 ('ARAFAH', 'يوم عرفة', '2028-05-04', 'RELIGIOUS', false, 0, 'يوم عرفة.. تقبّل الله منا ومنكم صالح الأعمال.'),
 ('EID_ADHA', 'عيد الأضحى', '2028-05-05', 'RELIGIOUS', true, 4, 'عيد أضحى مبارك، أعاده الله علينا وعليكم بالخير.'),
 ('HIJRI_NEW_YEAR', 'رأس السنة الهجرية 1450', '2028-05-25', 'OCCASION', false, 0, 'كل عام هجري وأنتم بخير.'),
 ('NATIONAL_DAY', 'اليوم الوطني السعودي', '2028-09-23', 'NATIONAL', true, 1, 'اليوم الوطني السعودي.. دام عزك يا وطن.');
