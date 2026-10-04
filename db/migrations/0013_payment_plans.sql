-- 0013: الاشتراك السنوي بالأقساط — خطة الدفع وأقساطها وتذكيرات الاستحقاق.
-- العقد سنوي بقيمة كاملة، يُقسَّط على 1 أو 2 أو 3 أو 4 أو 6 أو 12 دفعة؛ كل قسط يُدفع تصدر له فاتورة.

CREATE TABLE payment_plans (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    subscription_id uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
    plan_tier       varchar(30) NOT NULL REFERENCES plans(tier),
    total_net       numeric(12,2) NOT NULL CHECK (total_net > 0),           -- قيمة العقد قبل الضريبة
    installments    smallint NOT NULL CHECK (installments IN (1, 2, 3, 4, 6, 12)),
    starts_on       date NOT NULL,
    ends_on         date NOT NULL,
    status          varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMPLETED','CANCELED')),
    note            text,
    cancel_reason   text,
    created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_on > starts_on)
);
CREATE UNIQUE INDEX uq_payment_plan_active ON payment_plans(org_id) WHERE status = 'ACTIVE';

CREATE TABLE plan_installments (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id             uuid NOT NULL REFERENCES payment_plans(id) ON DELETE CASCADE,
    seq                 smallint NOT NULL CHECK (seq >= 1),
    due_date            date NOT NULL,
    amount_net          numeric(12,2) NOT NULL CHECK (amount_net > 0),
    paid_at             timestamptz,
    invoice_id          uuid REFERENCES invoices(id),
    payment_reference   varchar(100),
    UNIQUE (plan_id, seq),
    CHECK ((paid_at IS NULL) = (invoice_id IS NULL))
);
CREATE INDEX idx_installments_due ON plan_installments(due_date) WHERE paid_at IS NULL;

CREATE TABLE installment_reminders (
    id                  bigserial PRIMARY KEY,
    installment_id      uuid NOT NULL REFERENCES plan_installments(id) ON DELETE CASCADE,
    stage               varchar(10) NOT NULL CHECK (stage IN ('BEFORE_7','DUE','OVERDUE_3','MANUAL')),
    channel             varchar(10) NOT NULL CHECK (channel IN ('WHATSAPP','EMAIL')),
    recipient           varchar(255) NOT NULL,
    status              varchar(10) NOT NULL CHECK (status IN ('SENT','FAILED')),
    provider_message_id varchar(255),
    error               text,
    sent_by             uuid REFERENCES users(id) ON DELETE SET NULL,
    sent_at             timestamptz NOT NULL DEFAULT now()
);
-- التذكير الآلي لا يتكرر لنفس المرحلة والقناة والمستلم؛ اليدوي مسموح متى طُلب
CREATE UNIQUE INDEX uq_installment_reminder ON installment_reminders(installment_id, stage, channel, recipient)
    WHERE stage <> 'MANUAL' AND status = 'SENT';

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['payment_plans','plan_installments','installment_reminders'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON %I FROM haseef_app', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO haseef_platform', t);
    END LOOP;
END $$;
GRANT USAGE ON SEQUENCE installment_reminders_id_seq TO haseef_platform;
