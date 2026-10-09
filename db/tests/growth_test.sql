-- اختبار 0017: عزل الضريبة والبوت بين المنشآت، رقم جوال واحد لمنشأة واحدة، نوايا الدفع للمنصة فقط، والتنبيهات الضريبية.
\set ON_ERROR_STOP 1
DO $$
DECLARE a uuid; b uuid; m uuid;
BEGIN
  INSERT INTO organizations (cr_number, name, entity_legal_type) VALUES ('7000000171', 'منشأة النمو أ', 'LLC') RETURNING id INTO a;
  INSERT INTO organizations (cr_number, name, entity_legal_type) VALUES ('7000000172', 'منشأة النمو ب', 'LLC') RETURNING id INTO b;
  INSERT INTO tax_profiles (org_id, vat_registered) VALUES (a, true);
  INSERT INTO tax_tasks (org_id, kind, period_start, period_end, due_date) VALUES (a, 'VAT_RETURN', '2026-07-01', '2026-09-30', current_date + 5);
  INSERT INTO bot_members (org_id, full_name, phone) VALUES (a, 'موظف', '+966500000171') RETURNING id INTO m;
  BEGIN
    INSERT INTO bot_members (org_id, full_name, phone) VALUES (b, 'موظف آخر', '+966500000171');
    RAISE EXCEPTION 'same phone in two orgs';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    UPDATE bot_members SET status = 'ACTIVE' WHERE id = m;
    RAISE EXCEPTION 'active without consent';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT count(*) FROM v_alert_targets WHERE org_id = a AND target_type = 'TAX_TASK') <> 1 THEN
    RAISE EXCEPTION 'tax task missing from alert view';
  END IF;
  IF (SELECT 'ENTERPRISE' = ANY(included_tiers) FROM addon_catalog WHERE code = 'WA_BOT') IS NOT TRUE THEN
    RAISE EXCEPTION 'bot pricing seed';
  END IF;
  PERFORM set_config('growth_test.a', a::text, false);
END $$;
BEGIN;
SELECT set_config('app.org_id', current_setting('growth_test.a'), true);
SET LOCAL ROLE haseef_app;
DO $$ BEGIN
  IF (SELECT count(*) FROM tax_tasks) <> 1 OR (SELECT count(*) FROM bot_members) <> 1 THEN RAISE EXCEPTION 'isolation'; END IF;
  IF (SELECT count(*) FROM addon_catalog) < 1 THEN RAISE EXCEPTION 'catalog readable'; END IF;
  BEGIN
    PERFORM count(*) FROM payment_intents;
    RAISE EXCEPTION 'client role can read payment intents';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO org_addons (org_id, code, paid_until) VALUES (app.current_org_id(), 'WA_BOT', now() + interval '1 year');
    RAISE EXCEPTION 'client can activate addon';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
COMMIT;
SELECT 'Growth tests passed';
