-- اختبار 0022: شريحة 200، والعرض مرة واحدة لكل منشأة، وعزل الاستفادات، وعدم قدرة المنشأة على منح نفسها العرض.
\set ON_ERROR_STOP 1
DO $$
DECLARE a uuid; b uuid;
BEGIN
  IF (SELECT monthly_price FROM addon_catalog WHERE code = 'ATTENDANCE_200') <> 399 THEN RAISE EXCEPTION 'tier 200 price'; END IF;
  IF (SELECT max_redemptions FROM promotions WHERE code = 'HR_LAUNCH') <> 50 THEN RAISE EXCEPTION 'promo seed'; END IF;
  INSERT INTO organizations (cr_number, name, entity_legal_type) VALUES ('7000000221', 'منشأة العرض أ', 'LLC') RETURNING id INTO a;
  INSERT INTO organizations (cr_number, name, entity_legal_type) VALUES ('7000000222', 'منشأة العرض ب', 'LLC') RETURNING id INTO b;
  INSERT INTO promotion_redemptions (promo_code, org_id, addon_code, paid_until) VALUES ('HR_LAUNCH', a, 'ATTENDANCE', now() + interval '1 month');
  INSERT INTO promotion_redemptions (promo_code, org_id, addon_code, paid_until) VALUES ('HR_LAUNCH', b, 'ATTENDANCE_75', now() + interval '1 month');
  BEGIN
    INSERT INTO promotion_redemptions (promo_code, org_id, addon_code, paid_until) VALUES ('HR_LAUNCH', a, 'ATTENDANCE', now());
    RAISE EXCEPTION 'double redemption accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  PERFORM set_config('promo_test.a', a::text, false);
END $$;
BEGIN;
SELECT set_config('app.org_id', current_setting('promo_test.a'), true);
SET LOCAL ROLE haseef_app;
DO $$ BEGIN
  IF (SELECT count(*) FROM promotion_redemptions) <> 1 THEN RAISE EXCEPTION 'isolation'; END IF;
  IF (SELECT count(*) FROM promotions) = 0 THEN RAISE EXCEPTION 'promotions not readable'; END IF;
  BEGIN
    INSERT INTO promotion_redemptions (promo_code, org_id, addon_code, paid_until) VALUES ('HR_LAUNCH', current_setting('app.org_id')::uuid, 'ATTENDANCE_200', now());
    RAISE EXCEPTION 'tenant self-granted promo';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
COMMIT;
SELECT 'Promo tests passed';
