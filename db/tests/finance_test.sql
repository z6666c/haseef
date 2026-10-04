-- اختبار 0012: الفاتورة الصادرة لا تُعدَّل ولا تُحذف، ولا تتكرر لنفس الدفعة، ولا يصل لها دور العميل.
\set ON_ERROR_STOP 1
DO $$
DECLARE o uuid; inv uuid; ev bigint;
BEGIN
  INSERT INTO organizations (cr_number, name, entity_legal_type) VALUES ('7000000012', 'منشأة اختبار الفوترة', 'LLC') RETURNING id INTO o;
  INSERT INTO billing_events (org_id, event_type, plan_tier, amount_sar, period_months) VALUES (o, 'PAYMENT', 'ESSENTIAL', 199, 1) RETURNING id INTO ev;
  INSERT INTO invoices (number, source, org_id, billing_event_id, buyer_name, seller, lines, subtotal, vat_amount, total)
       VALUES ('HSF-T-1', 'SUBSCRIPTION', o, ev, 'منشأة اختبار الفوترة', '{}', '[]', 199, 29.85, 228.85) RETURNING id INTO inv;
  BEGIN
    INSERT INTO invoices (number, source, org_id, billing_event_id, buyer_name, seller, lines, subtotal, vat_amount, total)
         VALUES ('HSF-T-2', 'SUBSCRIPTION', o, ev, 'x', '{}', '[]', 199, 29.85, 228.85);
    RAISE EXCEPTION 'duplicate invoice for one payment';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    UPDATE invoices SET total = 1, subtotal = 1, vat_amount = 0 WHERE id = inv;
    RAISE EXCEPTION 'issued invoice amount changed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM invoices WHERE id = inv;
    RAISE EXCEPTION 'invoice deleted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO invoices (number, source, buyer_name, seller, lines, subtotal, vat_amount, total)
         VALUES ('HSF-T-3', 'MANUAL', 'x', '{}', '[]', 100, 15, 120);
    RAISE EXCEPTION 'total mismatch accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE invoices SET status = 'VOID', void_reason = 'اختبار' WHERE id = inv;    -- الإلغاء مسموح (مع إشعار دائن)
  IF NOT EXISTS (SELECT 1 FROM admin_roles WHERE code = 'BILLING' AND 'expenses.manage' = ANY(permissions)) THEN
    RAISE EXCEPTION 'billing role lacks expenses.manage';
  END IF;
  BEGIN
    UPDATE haseef_profile SET vat_registered = true, vat_number = NULL;
    RAISE EXCEPTION 'vat registered without number';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
SET ROLE haseef_app;
DO $$ BEGIN
  BEGIN
    PERFORM count(*) FROM invoices;
    RAISE EXCEPTION 'client role can read invoices';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM count(*) FROM expenses;
    RAISE EXCEPTION 'client role can read expenses';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SELECT 'Finance tests passed';
