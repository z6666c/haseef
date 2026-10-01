-- =====================================================================
-- 0002 — عروض محرك التنبيهات
-- تجمع الأهداف (عناصر + سياسات) مع القاعدة الفعّالة لكل منها، والمستلمين،
-- وحالة الاشتراك والحصة. منطق العتبات نفسه في Python (haseef/domain/alerts.py).
-- =====================================================================

CREATE VIEW v_alert_targets WITH (security_invoker = true) AS
SELECT 'COMPLIANCE_ITEM'::varchar(20)                                AS target_type,
       ci.id                                                         AS target_id,
       ci.org_id,
       ci.title,
       ci.expiry_date                                                AS due_date,
       ci.renewal_url                                                AS link,
       COALESCE(rs.days_before, rd.days_before, ARRAY[60,30,14,7,3,1,0]) AS thresholds,
       COALESCE(rs.channels,    rd.channels,    ARRAY['WHATSAPP','EMAIL']) AS channels,
       COALESCE(rs.is_enabled,  rd.is_enabled,  true)                AS enabled
FROM compliance_items ci
LEFT JOIN alert_rules rs ON rs.target_type = 'COMPLIANCE_ITEM' AND rs.target_id = ci.id
LEFT JOIN alert_rules rd ON rd.target_type = 'COMPLIANCE_ITEM' AND rd.target_id IS NULL AND rd.org_id = ci.org_id
WHERE ci.archived_at IS NULL
UNION ALL
SELECT 'POLICY',
       p.id,
       p.org_id,
       p.title,
       p.review_due_date,
       NULL,
       COALESCE(rs.days_before, rd.days_before, ARRAY[30,14,7,0]),   -- السياسات أقل إلحاحاً افتراضياً
       COALESCE(rs.channels,    rd.channels,    ARRAY['EMAIL','WHATSAPP']),
       COALESCE(rs.is_enabled,  rd.is_enabled,  true)
FROM internal_policies p
LEFT JOIN alert_rules rs ON rs.target_type = 'POLICY' AND rs.target_id = p.id
LEFT JOIN alert_rules rd ON rd.target_type = 'POLICY' AND rd.target_id IS NULL AND rd.org_id = p.org_id
WHERE p.status = 'ACTIVE';

CREATE VIEW v_alert_recipients WITH (security_invoker = true) AS
SELECT m.org_id,
       u.id            AS user_id,
       u.full_name,
       u.email::text   AS email,
       u.phone_number  AS phone,
       m.alert_channels AS channels
FROM memberships m
JOIN users u ON u.id = m.user_id
WHERE m.is_active AND m.receives_alerts AND u.is_active;

CREATE VIEW v_org_alert_context WITH (security_invoker = true) AS
SELECT o.id AS org_id,
       o.name AS org_name,
       (s.id IS NOT NULL) AS subscription_active,
       CASE WHEN pl.monthly_whatsapp_alerts IS NULL THEN NULL
            ELSE GREATEST(pl.monthly_whatsapp_alerts - COALESCE(used.n, 0), 0)
       END AS whatsapp_quota_remaining
FROM organizations o
LEFT JOIN subscriptions s
       ON s.org_id = o.id AND s.billing_status IN ('TRIAL','ACTIVE') AND now() BETWEEN s.starts_at AND s.ends_at
LEFT JOIN plans pl ON pl.tier = s.plan_tier
LEFT JOIN LATERAL (
    SELECT count(*) AS n FROM alert_dispatches d
    WHERE d.org_id = o.id AND d.channel = 'WHATSAPP'
      AND d.status NOT IN ('SKIPPED','CANCELED','FAILED')
      AND d.created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh'
) used ON true
WHERE o.is_active;

GRANT SELECT ON v_alert_targets, v_alert_recipients, v_org_alert_context TO haseef_app, haseef_platform;
GRANT SELECT ON v_compliance_items, v_internal_policies, v_monthly_ai_usage TO haseef_app, haseef_platform;

-- وقت حجز العامل للرسالة: لاستعادة الرسائل العالقة في SENDING إن تعطّل العامل.
ALTER TABLE alert_dispatches ADD COLUMN claimed_at timestamptz;
CREATE INDEX idx_alert_dispatches_stuck ON alert_dispatches(claimed_at) WHERE status = 'SENDING';
