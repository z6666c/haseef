-- =====================================================================
-- 0009 — طلبات التجربة من الصفحة التسويقية العامة
--   تُكتب من الخادم بصلاحية المنصة فقط (بلا دخول)، ويقرؤها فريق حصيف. العميل لا يصل إليها.
-- =====================================================================
CREATE TABLE trial_requests (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name       varchar(120) NOT NULL,
    company_name    varchar(200) NOT NULL,
    email           citext NOT NULL,
    phone_number    varchar(20),
    legal_type      varchar(30),
    employees_range varchar(10) CHECK (employees_range IN ('1-9','10-49','50-249','250+')),
    plan_interest   varchar(30) CHECK (plan_interest IN ('ESSENTIAL','PROFESSIONAL_GRC','ENTERPRISE','UNSURE')),
    interests       text[] NOT NULL DEFAULT '{}',
    message         text,
    source          varchar(60),
    consent         boolean NOT NULL CHECK (consent),          -- موافقة صريحة على التواصل ومعالجة البيانات
    status          varchar(12) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','CONTACTED','CONVERTED','REJECTED')),
    notes           text,
    handled_by      uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_trial_requests_status ON trial_requests(status, created_at DESC);
CREATE INDEX idx_trial_requests_email ON trial_requests(email, created_at DESC);

ALTER TABLE trial_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE trial_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON trial_requests FROM haseef_app;          -- بلا سياسة للعميل: لا قراءة ولا كتابة
GRANT SELECT, INSERT, UPDATE, DELETE ON trial_requests TO haseef_platform;
