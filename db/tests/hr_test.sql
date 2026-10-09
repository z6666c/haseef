-- اختبار 0019: عزل الإجازات والخصومات، وقيود التواريخ، وقراءة المناسبات للجميع.
\set ON_ERROR_STOP 1
DO $$
DECLARE a uuid; b uuid; e uuid; f uuid;
BEGIN
  INSERT INTO organizations (cr_number, name, entity_legal_type) VALUES ('7000000191', 'منشأة الموارد أ', 'LLC') RETURNING id INTO a;
  INSERT INTO organizations (cr_number, name, entity_legal_type) VALUES ('7000000192', 'منشأة الموارد ب', 'LLC') RETURNING id INTO b;
  INSERT INTO org_employees (org_id, full_name, nationality, start_date, basic_wage, mobile) VALUES (a, 'موظف أ', 'SAUDI', '2020-01-01', 6000, '+966500000001') RETURNING id INTO e;
  INSERT INTO org_employees (org_id, full_name, nationality, start_date, basic_wage) VALUES (b, 'موظف ب', 'SAUDI', '2025-01-01', 5000) RETURNING id INTO f;
  BEGIN
    UPDATE org_employees SET mobile = '0500000000' WHERE id = e;
    RAISE EXCEPTION 'bad mobile accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO leave_requests (org_id, employee_id, leave_type, start_date, end_date, days, source) VALUES (a, e, 'ANNUAL', '2027-01-03', '2027-01-07', 5, 'LINK');
  INSERT INTO leave_requests (org_id, employee_id, leave_type, start_date, end_date, days, source) VALUES (b, f, 'EMERGENCY', '2027-01-03', '2027-01-03', 1, 'BOT');
  BEGIN
    INSERT INTO leave_requests (org_id, employee_id, leave_type, start_date, end_date, days, source) VALUES (a, e, 'ANNUAL', '2027-01-07', '2027-01-03', 1, 'HR');
    RAISE EXCEPTION 'end before start accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO leave_requests (org_id, employee_id, leave_type, start_date, end_date, days, source) VALUES (a, e, 'MATERNITY', '2027-01-03', '2027-01-03', 1, 'HR');
    RAISE EXCEPTION 'unknown leave type accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO deduction_notices (org_id, employee_id, kind, incident_date, description, amount, payroll_month) VALUES (a, e, 'LATE', '2027-01-10', 'تأخر', 50, '2027-01-01');
  BEGIN
    INSERT INTO deduction_notices (org_id, employee_id, kind, incident_date, description, amount, payroll_month) VALUES (a, e, 'LATE', '2027-01-10', 'x', 50, '2027-01-15');
    RAISE EXCEPTION 'payroll month not first day accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT name FROM addon_catalog WHERE code = 'ATTENDANCE') <> 'الحضور والإجازات والخصومات' THEN RAISE EXCEPTION 'addon rename'; END IF;
  IF (SELECT count(*) FROM annual_events WHERE code = 'NATIONAL_DAY') < 2 THEN RAISE EXCEPTION 'events seed'; END IF;
  PERFORM set_config('hr_test.a', a::text, false);
END $$;
BEGIN;
SELECT set_config('app.org_id', current_setting('hr_test.a'), true);
SET LOCAL ROLE haseef_app;
DO $$ BEGIN
  IF (SELECT count(*) FROM leave_requests) <> 1 OR (SELECT count(*) FROM deduction_notices) <> 1 THEN RAISE EXCEPTION 'isolation'; END IF;
  IF (SELECT count(*) FROM annual_events) = 0 THEN RAISE EXCEPTION 'events not readable'; END IF;
  BEGIN
    UPDATE annual_events SET greeting = 'x';
    RAISE EXCEPTION 'tenant updated platform events';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
COMMIT;
SELECT 'HR tests passed';
