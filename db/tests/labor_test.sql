-- اختبار 0015: عزل سجل الموظفين والمهام بين المنشآت، ومهمة واحدة لكل نوع وشهر، وظهورها في التنبيهات.
\set ON_ERROR_STOP 1
DO $$
DECLARE a uuid; b uuid;
BEGIN
  INSERT INTO organizations (cr_number, name, entity_legal_type) VALUES ('7000000151', 'منشأة العمل أ', 'LLC') RETURNING id INTO a;
  INSERT INTO organizations (cr_number, name, entity_legal_type) VALUES ('7000000152', 'منشأة العمل ب', 'LLC') RETURNING id INTO b;
  INSERT INTO org_employees (org_id, full_name, nationality, start_date, basic_wage, iqama_expiry)
       VALUES (a, 'موظف أ', 'NON_SAUDI', '2025-01-01', 4000, current_date + 20);
  INSERT INTO org_employees (org_id, full_name, nationality, start_date, basic_wage) VALUES (b, 'موظف ب', 'SAUDI', '2025-01-01', 6000);
  INSERT INTO labor_tasks (org_id, period, kind, due_date) VALUES (a, '2026-09-01', 'GOSI_PAYMENT', '2026-10-15');
  BEGIN
    INSERT INTO labor_tasks (org_id, period, kind, due_date) VALUES (a, '2026-09-01', 'GOSI_PAYMENT', '2026-10-15');
    RAISE EXCEPTION 'duplicate task';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO org_employees (org_id, full_name, nationality, start_date, basic_wage, iqama_expiry)
         VALUES (a, 'سعودي بإقامة', 'SAUDI', '2025-01-01', 5000, '2027-01-01');
    RAISE EXCEPTION 'saudi with iqama';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT count(*) FROM v_alert_targets WHERE org_id = a AND target_type IN ('IQAMA','LABOR_TASK')) <> 2 THEN
    RAISE EXCEPTION 'labor targets missing from alert view';
  END IF;
  PERFORM set_config('labor_test.a', a::text, false);
END $$;
INSERT INTO expenses (spent_on, category, vendor, net_amount) VALUES (current_date, 'GOSI', 'التأمينات', 1000);
BEGIN;
SELECT set_config('app.org_id', current_setting('labor_test.a'), true);
SET LOCAL ROLE haseef_app;
DO $$ BEGIN
  IF (SELECT count(*) FROM org_employees) <> 1 THEN RAISE EXCEPTION 'employee isolation broken'; END IF;
  IF (SELECT count(*) FROM labor_tasks) <> 1 THEN RAISE EXCEPTION 'task isolation broken'; END IF;
  IF (SELECT count(*) FROM gosi_rates) < 3 THEN RAISE EXCEPTION 'rates not readable'; END IF;
  IF (SELECT count(*) FROM v_alert_targets WHERE target_type = 'IQAMA') <> 1 THEN RAISE EXCEPTION 'view isolation'; END IF;
END $$;
COMMIT;
SELECT 'Labor tests passed';
