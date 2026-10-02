-- =====================================================================
-- 0006 — حماية البيانات الشخصية: سجل حوادث التسرب وطلبات أصحاب البيانات
--   سجل أنشطة المعالجة موجود منذ 0001 (pdpl_data_records).
-- =====================================================================

CREATE TABLE pdpl_incidents (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    title                   varchar(255) NOT NULL,
    description             text,
    discovered_at           timestamptz NOT NULL,          -- يبدأ منه عدّاد الإبلاغ
    occurred_at             timestamptz,
    data_categories         jsonb NOT NULL DEFAULT '[]',
    subjects_affected       integer CHECK (subjects_affected >= 0),
    severity                varchar(10) NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW','MEDIUM','HIGH')),
    harm_likely             boolean NOT NULL DEFAULT true, -- هل يُحتمل ضرر لأصحاب البيانات؟ (يوجب الإبلاغ)
    status                  varchar(12) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN','CONTAINED','REPORTED','CLOSED')),
    authority_notified_at   timestamptz,
    subjects_notified_at    timestamptz,
    root_cause              text,
    actions_taken           text,
    created_by              uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CHECK (occurred_at IS NULL OR occurred_at <= discovered_at),
    CHECK (status <> 'REPORTED' OR authority_notified_at IS NOT NULL)
);
CREATE INDEX idx_pdpl_incidents_org ON pdpl_incidents(org_id, discovered_at DESC);

CREATE TABLE pdpl_requests (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    requester_name      varchar(150) NOT NULL,
    requester_contact   varchar(150),
    request_type        varchar(20) NOT NULL
        CHECK (request_type IN ('ACCESS','COPY','CORRECTION','DESTRUCTION','WITHDRAW_CONSENT','OBJECTION','OTHER')),
    channel             varchar(20) NOT NULL DEFAULT 'EMAIL' CHECK (channel IN ('EMAIL','PHONE','WEBSITE','IN_PERSON','OTHER')),
    details             text,
    received_on         date NOT NULL,
    due_on              date NOT NULL,
    identity_verified   boolean NOT NULL DEFAULT false,
    status              varchar(12) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','COMPLETED','REJECTED')),
    response_note       text,
    completed_on        date,
    created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (due_on >= received_on),
    CHECK ((status IN ('COMPLETED','REJECTED')) = (completed_on IS NOT NULL))
);
CREATE INDEX idx_pdpl_requests_org ON pdpl_requests(org_id, due_on);

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['pdpl_incidents','pdpl_requests'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app.current_org_id()) WITH CHECK (org_id = app.current_org_id())', t);
    END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON pdpl_incidents, pdpl_requests TO haseef_app, haseef_platform;
