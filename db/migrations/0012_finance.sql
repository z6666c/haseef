-- 0012: المالية الداخلية لحصيف — بيانات البائع، الفواتير الضريبية والإشعارات الدائنة، والمصروفات.
-- كلها بيانات منصة: لا يصل إليها دور العميل، وتُدار من غرفة العمليات بصلاحيات المالية.

CREATE TABLE haseef_profile (
    id              smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    legal_name      varchar(200) NOT NULL DEFAULT 'حصيف لتقنية المعلومات',
    trade_name      varchar(100) NOT NULL DEFAULT 'حصيف',
    vat_registered  boolean NOT NULL DEFAULT false,
    vat_number      varchar(15) CHECK (vat_number IS NULL OR vat_number ~ '^3[0-9]{13}3$'),
    cr_number       varchar(10) CHECK (cr_number IS NULL OR cr_number ~ '^[0-9]{10}$'),
    address         text,
    email           varchar(120),
    phone           varchar(20),
    iban            varchar(34),
    invoice_note    text,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      uuid REFERENCES users(id) ON DELETE SET NULL,
    CHECK (NOT vat_registered OR vat_number IS NOT NULL)
);
INSERT INTO haseef_profile (id) VALUES (1);

CREATE SEQUENCE invoice_number_seq;
CREATE SEQUENCE credit_note_number_seq;

CREATE TABLE invoices (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    number              varchar(20) NOT NULL UNIQUE,
    kind                varchar(12) NOT NULL DEFAULT 'INVOICE' CHECK (kind IN ('INVOICE','CREDIT_NOTE')),
    source              varchar(15) NOT NULL CHECK (source IN ('SUBSCRIPTION','CONSULTATION','MANUAL')),
    -- الفاتورة تبقى ولو حُذفت المنشأة (حفظ السجلات نظاماً)، لذا تُنسخ بيانات المشتري فيها
    org_id              uuid REFERENCES organizations(id) ON DELETE SET NULL,
    billing_event_id    bigint REFERENCES billing_events(id) ON DELETE SET NULL,
    consultation_id     uuid REFERENCES legal_consultations(id) ON DELETE SET NULL,
    related_invoice_id  uuid REFERENCES invoices(id),
    buyer_name          varchar(255) NOT NULL,
    buyer_cr            varchar(20),
    buyer_vat           varchar(15),
    seller              jsonb NOT NULL,                  -- لقطة من بيانات حصيف وقت الإصدار
    lines               jsonb NOT NULL,
    subtotal            numeric(12,2) NOT NULL CHECK (subtotal >= 0),
    vat_rate            numeric(5,4) NOT NULL DEFAULT 0.15,
    vat_amount          numeric(12,2) NOT NULL CHECK (vat_amount >= 0),
    total               numeric(12,2) NOT NULL,
    payment_reference   varchar(100),
    note                text,
    qr                  text,
    issued_at           timestamptz NOT NULL DEFAULT now(),
    status              varchar(10) NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED','VOID')),
    void_reason         text,
    created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
    CHECK (total = subtotal + vat_amount),
    CHECK (kind = 'INVOICE' OR related_invoice_id IS NOT NULL),
    CHECK (status = 'ISSUED' OR void_reason IS NOT NULL)
);
CREATE INDEX idx_invoices_issued ON invoices(issued_at DESC);
CREATE INDEX idx_invoices_org ON invoices(org_id, issued_at DESC);
-- فاتورة واحدة لكل دفعة اشتراك ولكل استشارة، وإشعار دائن واحد لكل فاتورة
CREATE UNIQUE INDEX uq_invoice_billing_event ON invoices(billing_event_id) WHERE kind = 'INVOICE' AND billing_event_id IS NOT NULL;
CREATE UNIQUE INDEX uq_invoice_consultation ON invoices(consultation_id) WHERE kind = 'INVOICE' AND consultation_id IS NOT NULL;
CREATE UNIQUE INDEX uq_credit_note_per_invoice ON invoices(related_invoice_id) WHERE kind = 'CREDIT_NOTE';

-- الفاتورة الصادرة لا تُعدَّل ولا تُحذف: التصحيح بإشعار دائن فقط (متطلب الفوترة الإلكترونية)
CREATE FUNCTION invoices_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'لا تُحذف الفواتير؛ أصدر إشعاراً دائناً' USING ERRCODE = 'check_violation';
    END IF;
    IF (to_jsonb(NEW) - 'status' - 'void_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'void_reason')
       OR (OLD.status = 'VOID') THEN
        RAISE EXCEPTION 'الفاتورة الصادرة لا تُعدَّل' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_invoices_immutable BEFORE UPDATE OR DELETE ON invoices
    FOR EACH ROW EXECUTE FUNCTION invoices_immutable();

CREATE TABLE expenses (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    spent_on        date NOT NULL,
    category        varchar(20) NOT NULL CHECK (category IN ('HOSTING','AI','MESSAGING','PAYMENT_FEES','SALARIES','LAWYER_FEES',
                                                             'MARKETING','PROFESSIONAL','GOVERNMENT','SOFTWARE','OFFICE','OTHER')),
    vendor          varchar(150) NOT NULL,
    description     text,
    net_amount      numeric(12,2) NOT NULL CHECK (net_amount > 0),
    vat_amount      numeric(12,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),   -- ضريبة مدخلات قابلة للخصم (بفاتورة ضريبية)
    total           numeric(12,2) GENERATED ALWAYS AS (net_amount + vat_amount) STORED,
    reference       varchar(100),
    recurring       boolean NOT NULL DEFAULT false,
    created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_expenses_spent ON expenses(spent_on DESC);

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['haseef_profile','invoices','expenses'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON %I FROM haseef_app', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO haseef_platform', t);
    END LOOP;
END $$;
GRANT USAGE ON SEQUENCE invoice_number_seq, credit_note_number_seq TO haseef_platform;

-- صلاحية جديدة: المصروفات وبيانات الفوترة، تُضاف لدور المحاسبة
UPDATE admin_roles SET permissions = array_append(permissions, 'expenses.manage'), updated_at = now()
 WHERE code = 'BILLING' AND NOT ('expenses.manage' = ANY(permissions));
