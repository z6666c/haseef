-- اختبار 0008: تقييم الأثر (قيود الاعتماد)، تقارير المجلس (العزل)، ربط المنشآت التابعة.
\set ON_ERROR_STOP 1
INSERT INTO organizations (id, cr_number, name, entity_legal_type) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '1010000951', 'الأم', 'CLOSED_JOINT_STOCK'),
  ('00000000-0000-0000-0000-0000000000e2', '1010000952', 'منشأة أخرى', 'LLC');
INSERT INTO organizations (id, cr_number, name, entity_legal_type, parent_org_id, entity_relation) VALUES
  ('00000000-0000-0000-0000-0000000000e3', '1010000953', 'تابعة', 'LLC', '00000000-0000-0000-0000-0000000000e1', 'SUBSIDIARY');

DO $$ BEGIN
  BEGIN
    INSERT INTO organizations (cr_number, name, entity_legal_type, entity_relation) VALUES ('1010000954', 'x', 'LLC', 'BRANCH');
    RAISE EXCEPTION 'relation without parent accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO dpia_assessments (org_id, project_name, status) VALUES ('00000000-0000-0000-0000-0000000000e1', 'p', 'APPROVED');
    RAISE EXCEPTION 'approved without approver accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO dpia_assessments (org_id, project_name, status) VALUES ('00000000-0000-0000-0000-0000000000e1', 'p', 'COMPLETED');
    RAISE EXCEPTION 'completed without date accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

INSERT INTO board_reports (org_id, year, snapshot) VALUES
  ('00000000-0000-0000-0000-0000000000e1', 2025, '{}'),
  ('00000000-0000-0000-0000-0000000000e2', 2025, '{}');
INSERT INTO dpia_assessments (org_id, project_name) VALUES
  ('00000000-0000-0000-0000-0000000000e1', 'مشروع أ'), ('00000000-0000-0000-0000-0000000000e2', 'مشروع ب');

SET ROLE haseef_app;
BEGIN;
SELECT set_config('app.org_id', '00000000-0000-0000-0000-0000000000e1', true) \g /dev/null
DO $$ BEGIN
  IF (SELECT count(*) FROM board_reports) <> 1 THEN RAISE EXCEPTION 'board reports leak'; END IF;
  IF (SELECT count(*) FROM dpia_assessments) <> 1 THEN RAISE EXCEPTION 'dpia leak'; END IF;
  -- الأم لا ترى صف التابعة عبر RLS؛ القراءة المجمعة تتم في الخادم بمعاملة لكل منشأة
  IF (SELECT count(*) FROM organizations) <> 1 THEN RAISE EXCEPTION 'organizations leak'; END IF;
  BEGIN
    INSERT INTO board_reports (org_id, year, snapshot) VALUES ('00000000-0000-0000-0000-0000000000e2', 2026, '{}');
    RAISE EXCEPTION 'cross-tenant board report insert';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;
RESET ROLE;
SELECT 'Enterprise tests passed';
