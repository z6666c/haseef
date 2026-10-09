-- اختبار 0024: الإنذار بلا مبلغ، والجزاء بمبلغ، والإعدادات الافتراضية.
\set ON_ERROR_STOP 1
DO $$
DECLARE a uuid; e uuid;
BEGIN
  INSERT INTO organizations (cr_number, name, entity_legal_type) VALUES ('7000000241', 'منشأة الجزاءات', 'LLC') RETURNING id INTO a;
  INSERT INTO org_employees (org_id, full_name, nationality, start_date, basic_wage, housing_allowance, other_allowances)
    VALUES (a, 'موظف', 'SAUDI', '2024-01-01', 6000, 1500, 500) RETURNING id INTO e;
  INSERT INTO hr_settings (org_id) VALUES (a);
  IF (SELECT deduction_method FROM hr_settings WHERE org_id = a) <> 'REGULATION' OR (SELECT wage_base FROM hr_settings WHERE org_id = a) <> 'TOTAL' THEN
    RAISE EXCEPTION 'defaults'; END IF;
  INSERT INTO deduction_notices (org_id, employee_id, kind, nature, bracket, occurrence, incident_date, description, amount, payroll_month)
    VALUES (a, e, 'LATE', 'WARNING', 'LATE_15', 1, '2027-01-10', 'إنذار', 0, '2027-01-01');
  INSERT INTO deduction_notices (org_id, employee_id, kind, nature, bracket, occurrence, incident_date, description, amount, payroll_month)
    VALUES (a, e, 'LATE', 'PENALTY', 'LATE_15', 2, '2027-01-11', 'جزاء', 13.33, '2027-01-01');
  BEGIN
    INSERT INTO deduction_notices (org_id, employee_id, kind, nature, incident_date, description, amount, payroll_month)
      VALUES (a, e, 'LATE', 'WARNING', '2027-01-12', 'x', 5, '2027-01-01');
    RAISE EXCEPTION 'warning with amount accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO deduction_notices (org_id, employee_id, kind, nature, incident_date, description, amount, payroll_month)
      VALUES (a, e, 'ABSENCE', 'WAGE', '2027-01-12', 'x', 0, '2027-01-01');
    RAISE EXCEPTION 'zero wage deduction accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
SELECT 'Penalty tests passed';
