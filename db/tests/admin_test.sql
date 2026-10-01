-- اختبار 0004: اتساق أدوار الفريق، تعليق المنشأة، وعزل سجل الفوترة.
\set ON_ERROR_STOP 1

INSERT INTO organizations (id, cr_number, name, entity_legal_type) VALUES
  ('00000000-0000-0000-0000-0000000000d0', '1010000500', 'منشأة د', 'LLC'),
  ('00000000-0000-0000-0000-0000000000e0', '1010000600', 'منشأة هـ', 'LLC');

-- دور الفريق ووسم المدير لا يختلفان أبداً
DO $$ BEGIN
  BEGIN
    INSERT INTO users (email, full_name, password_hash, is_platform_admin) VALUES ('x@h.sa', 'x', 'x', true);
    RAISE EXCEPTION 'admin flag without role accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO users (email, full_name, password_hash, platform_role) VALUES ('y@h.sa', 'y', 'x', 'SUPPORT');
    RAISE EXCEPTION 'role without admin flag accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
INSERT INTO users (email, full_name, password_hash, platform_role, is_platform_admin) VALUES ('ok@h.sa', 'ok', 'x', 'BILLING', true);

-- التعليق يتطلب سبباً
DO $$ BEGIN
  BEGIN
    UPDATE organizations SET suspended_at = now() WHERE id = '00000000-0000-0000-0000-0000000000d0';
    RAISE EXCEPTION 'suspension without reason accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- الدفعة تتطلب مبلغاً ومدة
DO $$ BEGIN
  BEGIN
    INSERT INTO billing_events (org_id, event_type) VALUES ('00000000-0000-0000-0000-0000000000d0', 'PAYMENT');
    RAISE EXCEPTION 'payment without amount accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
INSERT INTO billing_events (org_id, event_type, amount_sar, period_months) VALUES
  ('00000000-0000-0000-0000-0000000000d0', 'PAYMENT', 499, 1),
  ('00000000-0000-0000-0000-0000000000e0', 'PAYMENT', 199, 1);

-- العميل يرى فواتيره فقط ولا يكتب
SET ROLE haseef_app;
BEGIN;
SELECT set_config('app.org_id', '00000000-0000-0000-0000-0000000000d0', true) \g /dev/null
DO $$ BEGIN
  IF (SELECT count(*) FROM billing_events) <> 1 THEN RAISE EXCEPTION 'billing leak across tenants'; END IF;
  BEGIN
    INSERT INTO billing_events (org_id, event_type, amount_sar, period_months)
    VALUES ('00000000-0000-0000-0000-0000000000d0', 'PAYMENT', 1, 1);
    RAISE EXCEPTION 'tenant wrote its own billing event';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE users SET platform_role = 'SUPER_ADMIN' WHERE email = 'ok@h.sa';
    RAISE EXCEPTION 'tenant changed platform_role';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
COMMIT;
RESET ROLE;

SELECT 'Admin action tests passed' AS result;
