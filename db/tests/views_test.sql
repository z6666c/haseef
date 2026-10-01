-- اختبار عروض التنبيهات: القاعدة الخاصة تتغلب على الافتراضية، والسياسات مشمولة،
-- والعنصر المؤرشف مستبعد، وحالة الاشتراك والحصة صحيحة.
\set ON_ERROR_STOP 1

INSERT INTO organizations (id, cr_number, name, entity_legal_type) VALUES
  ('00000000-0000-0000-0000-0000000000c0', '1010000099', 'منشأة ج', 'LLC');
INSERT INTO subscriptions (org_id, plan_tier, billing_cycle, starts_at, ends_at) VALUES
  ('00000000-0000-0000-0000-0000000000c0', 'ESSENTIAL', 'MONTHLY', now() - interval '1 day', now() + interval '29 days');
INSERT INTO compliance_items (id, org_id, category, title, expiry_date) VALUES
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c0', 'BALADY', 'رخصة بلدي', current_date + 20),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c0', 'CHI_INSURANCE', 'التأمين الطبي', current_date + 5);
INSERT INTO compliance_items (org_id, category, title, expiry_date, archived_at) VALUES
  ('00000000-0000-0000-0000-0000000000c0', 'BALADY', 'رخصة قديمة مؤرشفة', current_date + 1, now());
INSERT INTO internal_policies (org_id, policy_type, title, review_due_date) VALUES
  ('00000000-0000-0000-0000-0000000000c0', 'PRIVACY_POLICY', 'سياسة الخصوصية', current_date + 10);
-- قاعدة افتراضية للمنشأة + قاعدة خاصة بعنصر التأمين
INSERT INTO alert_rules (org_id, target_type, days_before) VALUES
  ('00000000-0000-0000-0000-0000000000c0', 'COMPLIANCE_ITEM', ARRAY[30,7]);
INSERT INTO alert_rules (org_id, target_type, target_id, days_before, channels) VALUES
  ('00000000-0000-0000-0000-0000000000c0', 'COMPLIANCE_ITEM', '00000000-0000-0000-0000-0000000000c2', ARRAY[10,5,1], ARRAY['WHATSAPP']);
INSERT INTO alert_dispatches (org_id, target_type, target_id, due_date, threshold_days, channel, recipient_address, scheduled_for, status) VALUES
  ('00000000-0000-0000-0000-0000000000c0', 'COMPLIANCE_ITEM', '00000000-0000-0000-0000-0000000000c1', current_date + 20, 30, 'WHATSAPP', '+966500000009', now(), 'SENT');

SET ROLE haseef_app;
BEGIN;
SELECT set_config('app.org_id', '00000000-0000-0000-0000-0000000000c0', true) \g /dev/null
DO $$ BEGIN
  IF (SELECT count(*) FROM v_alert_targets) <> 3 THEN RAISE EXCEPTION 'expected 2 items + 1 policy (archived excluded), got %', (SELECT count(*) FROM v_alert_targets); END IF;
  IF (SELECT thresholds FROM v_alert_targets WHERE title = 'رخصة بلدي') <> ARRAY[30,7] THEN RAISE EXCEPTION 'default rule not applied'; END IF;
  IF (SELECT thresholds FROM v_alert_targets WHERE title = 'التأمين الطبي') <> ARRAY[10,5,1] THEN RAISE EXCEPTION 'item-specific rule should win'; END IF;
  IF (SELECT channels FROM v_alert_targets WHERE title = 'التأمين الطبي') <> ARRAY['WHATSAPP'] THEN RAISE EXCEPTION 'item channels wrong'; END IF;
  IF (SELECT thresholds FROM v_alert_targets WHERE target_type = 'POLICY') <> ARRAY[30,14,7,0] THEN RAISE EXCEPTION 'policy default thresholds wrong'; END IF;
  IF NOT (SELECT subscription_active FROM v_org_alert_context) THEN RAISE EXCEPTION 'subscription should be active'; END IF;
  IF (SELECT whatsapp_quota_remaining FROM v_org_alert_context) <> 199 THEN RAISE EXCEPTION 'quota should be 200 - 1 sent'; END IF;
END $$;
COMMIT;
RESET ROLE;

-- قيد عدم التكرار: نفس المفتاح مرتين يُرفض
DO $$ BEGIN
  BEGIN
    INSERT INTO alert_dispatches (org_id, target_type, target_id, due_date, threshold_days, channel, recipient_address, scheduled_for)
    VALUES ('00000000-0000-0000-0000-0000000000c0', 'COMPLIANCE_ITEM', '00000000-0000-0000-0000-0000000000c1', current_date + 20, 30, 'WHATSAPP', '+966500000009', now());
    RAISE EXCEPTION 'duplicate dispatch accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

SELECT 'Alert view tests passed' AS result;
