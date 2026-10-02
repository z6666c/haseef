-- اختبار 0007: الاستشارات القانونية — العزل، والعميل لا يعدّل السعر ولا يؤكد ولا يرى محامين غير معيّنين.
\set ON_ERROR_STOP 1
INSERT INTO organizations (id, cr_number, name, entity_legal_type) VALUES
  ('00000000-0000-0000-0000-0000000000c1', '1010000901', 'منشأة ك', 'LLC'),
  ('00000000-0000-0000-0000-0000000000c2', '1010000902', 'منشأة ل', 'LLC');
INSERT INTO legal_lawyers (id, full_name, license_number) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'محامٍ أ', 'L-1'),
  ('00000000-0000-0000-0000-0000000000d2', 'محامٍ ب', 'L-2');
INSERT INTO legal_consultations (org_id, topic, subject, duration_minutes, preferred_at, price, total_sar, status, lawyer_id, scheduled_at) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'CONTRACTS', 'عقد', 60, now(), '{}', 747.5, 'CONFIRMED', '00000000-0000-0000-0000-0000000000d1', now()),
  ('00000000-0000-0000-0000-0000000000c2', 'LABOR', 'عمل', 60, now(), '{}', 747.5, 'CONFIRMED', '00000000-0000-0000-0000-0000000000d2', now());

DO $$ BEGIN
  BEGIN
    INSERT INTO legal_consultations (org_id, topic, subject, duration_minutes, preferred_at, price, total_sar, status)
    VALUES ('00000000-0000-0000-0000-0000000000c1', 'LABOR', 'x', 60, now(), '{}', 1, 'CONFIRMED');
    RAISE EXCEPTION 'confirmed without lawyer accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

SET ROLE haseef_app;
BEGIN;
SELECT set_config('app.org_id', '00000000-0000-0000-0000-0000000000c1', true) \g /dev/null
DO $$ BEGIN
  IF (SELECT count(*) FROM legal_consultations) <> 1 THEN RAISE EXCEPTION 'consultations leak'; END IF;
  IF (SELECT count(*) FROM legal_lawyers) <> 1 THEN RAISE EXCEPTION 'unassigned lawyer visible'; END IF;
  IF (SELECT count(*) FROM legal_rates) < 7 THEN RAISE EXCEPTION 'rates not visible'; END IF;
  BEGIN
    UPDATE legal_consultations SET total_sar = 1;
    RAISE EXCEPTION 'client changed price';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE legal_consultations SET payment_status = 'PAID', payment_reference = 'x';
    RAISE EXCEPTION 'client marked paid';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE legal_rates SET hourly_rate_sar = 1;
    RAISE EXCEPTION 'client changed rates';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
UPDATE legal_consultations SET status = 'CANCELED', cancel_reason = 'تغيير الموعد', updated_at = now();
ROLLBACK;
RESET ROLE;
SELECT 'Legal tests passed';
