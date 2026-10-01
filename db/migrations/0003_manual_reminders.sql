-- =====================================================================
-- 0003 — التذكير اليدوي الفوري ("أرسل تذكير واتساب الآن" في جدول الطوارئ)
--
-- قيد عدم التكرار يخص التنبيهات التلقائية فقط؛ التذكير اليدوي مسموح بتكراره،
-- مع حد زمني يُفرض في الخادم (مرة كل ساعة لكل عنصر).
-- =====================================================================

ALTER TABLE alert_dispatches
    ADD COLUMN kind varchar(10) NOT NULL DEFAULT 'AUTO' CHECK (kind IN ('AUTO','MANUAL')),
    ADD COLUMN requested_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- استبدال القيد الفريد العام بفهرس فريد جزئي للتلقائي فقط.
DO $$
DECLARE c text;
BEGIN
    SELECT conname INTO c FROM pg_constraint
    WHERE conrelid = 'alert_dispatches'::regclass AND contype = 'u';
    IF c IS NOT NULL THEN
        EXECUTE format('ALTER TABLE alert_dispatches DROP CONSTRAINT %I', c);
    END IF;
END $$;

CREATE UNIQUE INDEX uq_alert_dispatches_auto
    ON alert_dispatches (target_type, target_id, due_date, threshold_days, channel, recipient_address)
    WHERE kind = 'AUTO';

CREATE INDEX idx_alert_dispatches_manual_recent
    ON alert_dispatches (target_id, created_at DESC) WHERE kind = 'MANUAL';
