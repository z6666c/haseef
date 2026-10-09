-- 0018: الحضور بالموقع وبصمة الجوال (إضافة مدفوعة ATTENDANCE)
--   * مواقع المنشأة بنصف قطر، وأوقات الدوام، وسياسة الاحتفاظ بالموقع (يُحذف الإحداثي بعد المدة ويبقى السجل)
--   * رابط شخصي لكل موظف + ربط جهازه ببصمة الجوال (WebAuthn): البصمة لا تغادر الجهاز؛ نخزن المفتاح العام فقط
--   * سجل الحضور: مقبول أو مرفوض مع السبب، والمسافة ودقة القراءة، وعلامات اشتباه

INSERT INTO addon_catalog (code, name, monthly_price, included_tiers, limits) VALUES
 ('ATTENDANCE', 'الحضور بالموقع وبصمة الجوال', 49, '{ENTERPRISE}', '{"members": 50, "included_unlimited": true}');

CREATE TABLE attendance_settings (
    org_id          uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    work_start      time NOT NULL DEFAULT '08:00',
    work_end        time NOT NULL DEFAULT '17:00',
    grace_minutes   smallint NOT NULL DEFAULT 15 CHECK (grace_minutes BETWEEN 0 AND 180),
    work_days       smallint[] NOT NULL DEFAULT '{0,1,2,3,4}',      -- 0 = الأحد
    require_device  boolean NOT NULL DEFAULT true,
    retention_days  smallint NOT NULL DEFAULT 90 CHECK (retention_days BETWEEN 7 AND 730),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE attendance_sites (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            varchar(120) NOT NULL,
    lat             numeric(9,6) NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lng             numeric(9,6) NOT NULL CHECK (lng BETWEEN -180 AND 180),
    radius_m        integer NOT NULL DEFAULT 100 CHECK (radius_m BETWEEN 20 AND 2000),
    max_accuracy_m  integer NOT NULL DEFAULT 100 CHECK (max_accuracy_m BETWEEN 10 AND 1000),
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE attendance_people (
    employee_id     uuid PRIMARY KEY REFERENCES org_employees(id) ON DELETE CASCADE,
    org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    token_hash      char(64) NOT NULL UNIQUE,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE attendance_devices (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    employee_id     uuid NOT NULL REFERENCES org_employees(id) ON DELETE CASCADE,
    credential_id   text NOT NULL UNIQUE,                 -- base64url
    public_key      bytea NOT NULL,                       -- مفتاح COSE العام
    sign_count      bigint NOT NULL DEFAULT 0,
    label           varchar(80),
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_used_at    timestamptz,
    revoked_at      timestamptz
);
CREATE UNIQUE INDEX uq_attendance_device_active ON attendance_devices(employee_id) WHERE revoked_at IS NULL;
CREATE TABLE attendance_challenges (
    challenge       varchar(64) PRIMARY KEY,
    org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    employee_id     uuid NOT NULL REFERENCES org_employees(id) ON DELETE CASCADE,
    purpose         varchar(8) NOT NULL CHECK (purpose IN ('ENROLL','CHECK')),
    expires_at      timestamptz NOT NULL,
    used_at         timestamptz
);
CREATE TABLE attendance_records (
    id              bigserial PRIMARY KEY,
    org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    employee_id     uuid NOT NULL REFERENCES org_employees(id) ON DELETE CASCADE,
    kind            char(3) NOT NULL CHECK (kind IN ('IN','OUT')),
    at              timestamptz NOT NULL DEFAULT now(),
    status          varchar(10) NOT NULL CHECK (status IN ('ACCEPTED','REJECTED')),
    reason          varchar(30),
    site_id         uuid REFERENCES attendance_sites(id) ON DELETE SET NULL,
    distance_m      integer,
    accuracy_m      integer,
    lat             numeric(9,6),
    lng             numeric(9,6),
    device_id       uuid REFERENCES attendance_devices(id) ON DELETE SET NULL,
    late_minutes    integer,
    flags           text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_attendance_records_org_day ON attendance_records(org_id, at DESC);

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['attendance_settings','attendance_sites','attendance_people','attendance_devices','attendance_challenges','attendance_records'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app.current_org_id()) WITH CHECK (org_id = app.current_org_id())', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO haseef_app, haseef_platform', t);
    END LOOP;
END $$;
GRANT USAGE ON SEQUENCE attendance_records_id_seq TO haseef_app, haseef_platform;
