-- 0014: الدورية في المالية — نوع اشتراك كل فاتورة (شهري/سنوي)، ودورية المصروف (مرة واحدة/شهري/سنوي).

ALTER TABLE invoices ADD COLUMN plan_cycle varchar(10) CHECK (plan_cycle IN ('MONTHLY','YEARLY'));
-- تعبئة الفواتير السابقة من دفعاتها: دفعة شهر واحد خارج خطة الأقساط = شهري، وما عداها سنوي
ALTER TABLE invoices DISABLE TRIGGER trg_invoices_immutable;
UPDATE invoices i SET plan_cycle = CASE WHEN b.period_months = 1 AND COALESCE(b.note, '') NOT LIKE 'القسط%' THEN 'MONTHLY' ELSE 'YEARLY' END
  FROM billing_events b WHERE b.id = i.billing_event_id AND i.source = 'SUBSCRIPTION';
UPDATE invoices c SET plan_cycle = o.plan_cycle FROM invoices o WHERE o.id = c.related_invoice_id AND c.kind = 'CREDIT_NOTE';
ALTER TABLE invoices ENABLE TRIGGER trg_invoices_immutable;

ALTER TABLE expenses ADD COLUMN frequency varchar(10) NOT NULL DEFAULT 'ONE_TIME'
    CHECK (frequency IN ('ONE_TIME','MONTHLY','YEARLY'));
UPDATE expenses SET frequency = 'MONTHLY' WHERE recurring;
ALTER TABLE expenses DROP COLUMN recurring;
