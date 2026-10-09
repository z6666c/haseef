-- اختبار 0020: أجر الإجازة لكل طلب، ووضع الأجر في السياسة.
\set ON_ERROR_STOP 1
DO $$
DECLARE a uuid; e uuid; l uuid;
BEGIN
  INSERT INTO organizations (cr_number, name, entity_legal_type) VALUES ('7000000201', 'منشأة أجر الإجازة', 'LLC') RETURNING id INTO a;
  INSERT INTO org_employees (org_id, full_name, nationality, start_date, basic_wage) VALUES (a, 'موظف', 'SAUDI', '2024-01-01', 6000) RETURNING id INTO e;
  INSERT INTO leave_requests (org_id, employee_id, leave_type, start_date, end_date, days, source) VALUES (a, e, 'REGULAR', '2027-01-03', '2027-01-04', 2, 'LINK') RETURNING id INTO l;
  IF NOT (SELECT is_paid FROM leave_requests WHERE id = l) THEN RAISE EXCEPTION 'default paid'; END IF;
  INSERT INTO leave_requests (org_id, employee_id, leave_type, start_date, end_date, days, source, is_paid) VALUES (a, e, 'EMERGENCY', '2027-02-03', '2027-02-03', 1, 'BOT', false);
  INSERT INTO hr_leave_policies (org_id, leave_type, is_paid, from_balance, pay_mode) VALUES (a, 'REGULAR', true, true, 'CHOICE');
  BEGIN
    INSERT INTO hr_leave_policies (org_id, leave_type, is_paid, from_balance, pay_mode) VALUES (a, 'EMERGENCY', true, true, 'MAYBE');
    RAISE EXCEPTION 'bad pay_mode accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
SELECT 'Leave pay tests passed';
-- 0021: التسعير الجديد والشرائح
DO $$ BEGIN
  IF (SELECT monthly_price_sar FROM plans WHERE tier = 'ESSENTIAL') <> 219 OR (SELECT yearly_price_sar FROM plans WHERE tier = 'ENTERPRISE') <> 14290 THEN RAISE EXCEPTION 'plan prices'; END IF;
  IF NOT (SELECT limits->'grants' ? 'WA_BOT' FROM addon_catalog WHERE code = 'STAFF_BUNDLE') THEN RAISE EXCEPTION 'bundle grants'; END IF;
  IF (SELECT (limits->>'members')::int FROM addon_catalog WHERE code = 'ATTENDANCE_75') <> 75 THEN RAISE EXCEPTION 'tier 75'; END IF;
END $$;
SELECT 'Pricing tests passed';
