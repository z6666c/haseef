-- اختبار 0005: الكتالوجات المرجعية (العميل يقرأ الظاهر فقط ولا يكتب) وعزل هيكل الحوكمة بين المنشآت.
\set ON_ERROR_STOP 1

INSERT INTO organizations (id, cr_number, name, entity_legal_type) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '1010000701', 'منشأة و', 'CLOSED_JOINT_STOCK'),
  ('00000000-0000-0000-0000-0000000000f2', '1010000702', 'منشأة ز', 'LLC');

SET ROLE haseef_platform;
INSERT INTO gov_standards (code, domain, title, description, level, severity, rule, is_visible) VALUES
  ('T_VISIBLE', 'BOARD', 'ظاهر', 'x', 'MANDATORY', 'high', '{"check":"doa_exists"}', true),
  ('T_HIDDEN',  'BOARD', 'مخفي', 'x', 'MANDATORY', 'high', '{"check":"doa_exists"}', false);
INSERT INTO library_documents (kind, category, title, url, is_visible) VALUES
  ('LAW', 'COMMERCIAL', 'ظاهر', 'https://a.sa', true),
  ('LAW', 'COMMERCIAL', 'مخفي', 'https://b.sa', false);
INSERT INTO obligation_catalog (code, kind, domain, title, description, frequency, risk_level, is_visible) VALUES
  ('T_OBL', 'PRACTICE', 'LABOR', 'ت', 'ت', 'ONCE', 'HIGH', true);
INSERT INTO org_bodies (org_id, body_type, name) VALUES
  ('00000000-0000-0000-0000-0000000000f1', 'BOARD', 'مجلس و'),
  ('00000000-0000-0000-0000-0000000000f2', 'MANAGER', 'مدير ز');
INSERT INTO org_obligations (org_id, code) VALUES
  ('00000000-0000-0000-0000-0000000000f1', 'T_OBL'),
  ('00000000-0000-0000-0000-0000000000f2', 'T_OBL');
RESET ROLE;

-- قيود سلامة المحتوى
DO $$ BEGIN
  BEGIN
    INSERT INTO library_documents (kind, category, title) VALUES ('LAW', 'COMMERCIAL', 'بلا رابط');
    RAISE EXCEPTION 'law without url accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO library_documents (kind, category, title) VALUES ('FILE', 'COMMERCIAL', 'بلا ملف');
    RAISE EXCEPTION 'file without key accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

SET ROLE haseef_app;
BEGIN;
SELECT set_config('app.org_id', '00000000-0000-0000-0000-0000000000f1', true) \g /dev/null
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM gov_standards WHERE code = 'T_HIDDEN') THEN RAISE EXCEPTION 'hidden standard visible to client'; END IF;
  IF NOT EXISTS (SELECT 1 FROM gov_standards WHERE code = 'T_VISIBLE') THEN RAISE EXCEPTION 'visible standard missing'; END IF;
  IF EXISTS (SELECT 1 FROM library_documents WHERE title = 'مخفي') THEN RAISE EXCEPTION 'hidden library doc visible'; END IF;
  IF (SELECT count(*) FROM org_bodies) <> 1 THEN RAISE EXCEPTION 'org_bodies leak across tenants'; END IF;
  IF (SELECT count(*) FROM org_obligations) <> 1 THEN RAISE EXCEPTION 'org_obligations leak across tenants'; END IF;
  BEGIN
    UPDATE gov_standards SET is_visible = true WHERE code = 'T_HIDDEN';
    RAISE EXCEPTION 'client modified catalog';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO library_documents (kind, category, title, url) VALUES ('LAW', 'COMMERCIAL', 'دخيل', 'https://x.sa');
    RAISE EXCEPTION 'client inserted library doc';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO org_bodies (org_id, body_type, name) VALUES ('00000000-0000-0000-0000-0000000000f2', 'BOARD', 'دخيل');
    RAISE EXCEPTION 'client wrote into another org structure';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
-- يكتب هيكله هو
INSERT INTO org_bodies (org_id, body_type, name) VALUES ('00000000-0000-0000-0000-0000000000f1', 'AUDIT_COMMITTEE', 'لجنة المراجعة');
INSERT INTO gov_check_runs (org_id, passed, failed, not_applicable, results) VALUES ('00000000-0000-0000-0000-0000000000f1', 1, 0, 0, '[]');
DO $$ BEGIN
  BEGIN
    DELETE FROM gov_check_runs;
    RAISE EXCEPTION 'client deleted check history';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;
RESET ROLE;

SELECT 'Catalog tests passed';
