-- اختبار 0006: عزل الحوادث والطلبات بين المنشآت، وقيود الإغلاق والإبلاغ.
\set ON_ERROR_STOP 1
INSERT INTO organizations (id, cr_number, name, entity_legal_type) VALUES
  ('00000000-0000-0000-0000-0000000000a7', '1010000801', 'منشأة ح', 'LLC'),
  ('00000000-0000-0000-0000-0000000000a8', '1010000802', 'منشأة ط', 'LLC');
INSERT INTO pdpl_requests (org_id, requester_name, request_type, received_on, due_on) VALUES
  ('00000000-0000-0000-0000-0000000000a7', 'أ', 'ACCESS', '2026-09-01', '2026-10-01'),
  ('00000000-0000-0000-0000-0000000000a8', 'ب', 'ACCESS', '2026-09-01', '2026-10-01');
INSERT INTO pdpl_incidents (org_id, title, discovered_at) VALUES
  ('00000000-0000-0000-0000-0000000000a7', 'حادثة', now()),
  ('00000000-0000-0000-0000-0000000000a8', 'حادثة', now());

DO $$ BEGIN
  BEGIN
    UPDATE pdpl_requests SET status = 'COMPLETED' WHERE requester_name = 'أ';
    RAISE EXCEPTION 'completed request without completion date accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE pdpl_incidents SET status = 'REPORTED' WHERE org_id = '00000000-0000-0000-0000-0000000000a7';
    RAISE EXCEPTION 'reported incident without notification time accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

SET ROLE haseef_app;
BEGIN;
SELECT set_config('app.org_id', '00000000-0000-0000-0000-0000000000a7', true) \g /dev/null
DO $$ BEGIN
  IF (SELECT count(*) FROM pdpl_requests) <> 1 THEN RAISE EXCEPTION 'requests leak across tenants'; END IF;
  IF (SELECT count(*) FROM pdpl_incidents) <> 1 THEN RAISE EXCEPTION 'incidents leak across tenants'; END IF;
  BEGIN
    INSERT INTO pdpl_incidents (org_id, title, discovered_at) VALUES ('00000000-0000-0000-0000-0000000000a8', 'دخيل', now());
    RAISE EXCEPTION 'wrote incident into another org';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;
RESET ROLE;
SELECT 'PDPL tests passed';
