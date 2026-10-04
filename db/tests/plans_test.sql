-- اختبار 0013: خطة دفع واحدة فعّالة لكل منشأة، والقسط المدفوع مرتبط بفاتورة، ولا يصل لها دور العميل.
\set ON_ERROR_STOP 1
DO $$
DECLARE o uuid; p uuid;
BEGIN
  INSERT INTO organizations (cr_number, name, entity_legal_type) VALUES ('7000000013', 'منشأة الأقساط', 'LLC') RETURNING id INTO o;
  INSERT INTO payment_plans (org_id, plan_tier, total_net, installments, starts_on, ends_on)
       VALUES (o, 'PROFESSIONAL_GRC', 4990, 4, '2026-10-01', '2027-10-01') RETURNING id INTO p;
  INSERT INTO plan_installments (plan_id, seq, due_date, amount_net) VALUES (p, 1, '2026-10-01', 1247.5);
  BEGIN
    INSERT INTO payment_plans (org_id, plan_tier, total_net, installments, starts_on, ends_on)
         VALUES (o, 'ESSENTIAL', 1990, 2, '2026-10-01', '2027-10-01');
    RAISE EXCEPTION 'two active plans';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    UPDATE plan_installments SET paid_at = now() WHERE plan_id = p;
    RAISE EXCEPTION 'paid without invoice';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO payment_plans (org_id, plan_tier, total_net, installments, starts_on, ends_on)
         VALUES (o, 'ESSENTIAL', 1990, 5, '2026-10-01', '2027-10-01');
    RAISE EXCEPTION 'five installments accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
SET ROLE haseef_app;
DO $$ BEGIN
  BEGIN
    PERFORM count(*) FROM plan_installments;
    RAISE EXCEPTION 'client role can read installments';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SELECT 'Payment plan tests passed';
