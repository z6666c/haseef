-- اختبار 0010: الأدوار الإدارية المخصصة — المفتاح الأجنبي، ومنع حذف دور مسند، وحجبها عن دور العميل.
\set ON_ERROR_STOP 1
DO $$ BEGIN
  IF (SELECT count(*) FROM admin_roles WHERE is_system) <> 3 THEN RAISE EXCEPTION 'system roles missing'; END IF;
  INSERT INTO admin_roles (code, name, permissions) VALUES ('CONTENT_EDITOR', 'محرر المحتوى', ARRAY['content.manage']);
  INSERT INTO users (email, full_name, password_hash, platform_role, is_platform_admin)
       VALUES ('editor@test.sa', 'محرر', 'x', 'CONTENT_EDITOR', true);
  BEGIN
    UPDATE users SET platform_role = 'NO_SUCH_ROLE' WHERE email = 'editor@test.sa';
    RAISE EXCEPTION 'unknown role accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM admin_roles WHERE code = 'CONTENT_EDITOR';
    RAISE EXCEPTION 'assigned role deleted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO admin_roles (code, name) VALUES ('bad code', 'سيء');
    RAISE EXCEPTION 'invalid code accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  DELETE FROM users WHERE email = 'editor@test.sa';
  DELETE FROM admin_roles WHERE code = 'CONTENT_EDITOR';
END $$;
SET ROLE haseef_app;
DO $$ BEGIN
  BEGIN
    PERFORM count(*) FROM admin_roles;
    RAISE EXCEPTION 'client role can read admin roles';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SELECT 'Admin role tests passed';
