-- اختبار 0018: جهاز فعّال واحد لكل موظف، وعزل سجلات الحضور، وتسعير الإضافة.
\set ON_ERROR_STOP 1
DO $$
DECLARE a uuid; b uuid; e uuid; f uuid;
BEGIN
  INSERT INTO organizations (cr_number, name, entity_legal_type) VALUES ('7000000181', 'منشأة الحضور أ', 'LLC') RETURNING id INTO a;
  INSERT INTO organizations (cr_number, name, entity_legal_type) VALUES ('7000000182', 'منشأة الحضور ب', 'LLC') RETURNING id INTO b;
  INSERT INTO org_employees (org_id, full_name, nationality, start_date, basic_wage) VALUES (a, 'موظف أ', 'SAUDI', '2025-01-01', 5000) RETURNING id INTO e;
  INSERT INTO org_employees (org_id, full_name, nationality, start_date, basic_wage) VALUES (b, 'موظف ب', 'SAUDI', '2025-01-01', 5000) RETURNING id INTO f;
  INSERT INTO attendance_devices (org_id, employee_id, credential_id, public_key) VALUES (a, e, 'cred-1', '\x01');
  BEGIN
    INSERT INTO attendance_devices (org_id, employee_id, credential_id, public_key) VALUES (a, e, 'cred-2', '\x02');
    RAISE EXCEPTION 'two active devices';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  INSERT INTO attendance_records (org_id, employee_id, kind, status) VALUES (a, e, 'IN', 'ACCEPTED'), (b, f, 'IN', 'ACCEPTED');
  BEGIN
    INSERT INTO attendance_sites (org_id, name, lat, lng, radius_m) VALUES (a, 'x', 24.7, 46.7, 5);
    RAISE EXCEPTION 'radius below 20m accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT monthly_price FROM addon_catalog WHERE code = 'ATTENDANCE') <> 49 THEN RAISE EXCEPTION 'attendance price seed'; END IF;
  PERFORM set_config('att_test.a', a::text, false);
END $$;
BEGIN;
SELECT set_config('app.org_id', current_setting('att_test.a'), true);
SET LOCAL ROLE haseef_app;
DO $$ BEGIN
  IF (SELECT count(*) FROM attendance_records) <> 1 OR (SELECT count(*) FROM attendance_devices) <> 1 THEN RAISE EXCEPTION 'isolation'; END IF;
END $$;
COMMIT;
SELECT 'Attendance tests passed';
