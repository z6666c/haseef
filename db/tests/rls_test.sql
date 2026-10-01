-- اختبار عزل المستأجرين: يُشغَّل بعد 0001_init.sql على قاعدة اختبار.
-- يفشل (ERROR) عند أي تسرّب بين المنشآت.
\set ON_ERROR_STOP 1

-- تجهيز بيانات منشأتين كمالك قاعدة البيانات
INSERT INTO organizations (id, cr_number, name, entity_legal_type) VALUES
  ('00000000-0000-0000-0000-00000000000a', '1010000001', 'منشأة أ', 'LLC'),
  ('00000000-0000-0000-0000-00000000000b', '1010000002', 'منشأة ب', 'LLC');
INSERT INTO users (id, email, full_name, password_hash) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.sa', 'مستخدم أ', 'x'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@example.sa', 'مستخدم ب', 'x');
INSERT INTO memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'ORG_ADMIN'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'ORG_ADMIN');
INSERT INTO compliance_items (org_id, category, title, expiry_date) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'COMMERCIAL_REG', 'سجل أ', current_date + 10),
  ('00000000-0000-0000-0000-00000000000b', 'COMMERCIAL_REG', 'سجل ب', current_date + 90);

SET ROLE haseef_app;

-- 1) بلا سياق منشأة: لا يُرى شيء
DO $$ BEGIN
  IF (SELECT count(*) FROM compliance_items) <> 0 THEN RAISE EXCEPTION 'leak: rows visible without org context'; END IF;
  IF (SELECT count(*) FROM organizations) <> 0 THEN RAISE EXCEPTION 'leak: orgs visible without org context'; END IF;
END $$;

-- 2) في سياق منشأة أ: ترى عنصرها فقط ومستخدمها فقط
BEGIN;
SELECT set_config('app.org_id',  '00000000-0000-0000-0000-00000000000a', true);
SELECT set_config('app.user_id', '00000000-0000-0000-0000-0000000000a1', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM compliance_items) <> 1 THEN RAISE EXCEPTION 'expected 1 item for org A'; END IF;
  IF EXISTS (SELECT 1 FROM compliance_items WHERE title = 'سجل ب') THEN RAISE EXCEPTION 'leak: org B item visible to A'; END IF;
  IF EXISTS (SELECT 1 FROM users WHERE email = 'b@example.sa') THEN RAISE EXCEPTION 'leak: org B user visible to A'; END IF;
  IF (SELECT status FROM v_compliance_items) <> 'EXPIRING_SOON' THEN RAISE EXCEPTION 'derived status wrong'; END IF;
  IF NOT (SELECT action_required FROM v_compliance_items) THEN RAISE EXCEPTION 'action_required should be true at 10 days'; END IF;
END $$;

-- 3) محاولة كتابة صف لمنشأة أخرى تُرفض
DO $$ BEGIN
  BEGIN
    INSERT INTO compliance_items (org_id, category, title, expiry_date)
    VALUES ('00000000-0000-0000-0000-00000000000b', 'BALADY', 'حقن', current_date);
    RAISE EXCEPTION 'leak: cross-tenant insert succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; -- متوقع: new row violates row-level security policy
  END;
END $$;

-- 4) تعديل عنصر منشأة ب لا يمس أي صف
DO $$ DECLARE n int; BEGIN
  UPDATE compliance_items SET title = 'مخترق' WHERE title = 'سجل ب';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'leak: cross-tenant update touched % rows', n; END IF;
END $$;

-- 5) المستخدم لا يستطيع ترقية نفسه لمدير منصة
DO $$ BEGIN
  BEGIN
    UPDATE users SET is_platform_admin = true WHERE id = app.current_user_id();
    RAISE EXCEPTION 'privilege escalation succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
COMMIT;

RESET ROLE;
SELECT 'RLS tests passed' AS result;
