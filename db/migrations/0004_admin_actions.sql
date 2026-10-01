-- =====================================================================
-- 0004 — صلاحيات فريق حصيف وإجراءات الإدارة
--   * أدوار الفريق: مدير عام / دعم فني / محاسبة
--   * تعليق المنشأة مع السبب
--   * سجل أحداث الفوترة (دفعات، تغيير باقة، تمديد تجربة، إلغاء)
--   * كلمة المرور المؤقتة: إجبار التغيير عند أول دخول
-- =====================================================================

-- ---------- أدوار الفريق ----------
ALTER TABLE users
    ADD COLUMN platform_role varchar(20)
        CHECK (platform_role IN ('SUPER_ADMIN','SUPPORT','BILLING')),
    ADD COLUMN must_change_password boolean NOT NULL DEFAULT false,
    ADD COLUMN password_changed_at timestamptz;

UPDATE users SET platform_role = 'SUPER_ADMIN' WHERE is_platform_admin AND platform_role IS NULL;

-- is_platform_admin يبقى للتوافق، لكنه مشتق من وجود الدور ولا يختلف عنه أبداً.
ALTER TABLE users ADD CONSTRAINT users_platform_role_consistent
    CHECK (is_platform_admin = (platform_role IS NOT NULL));

-- ---------- تعليق المنشأة ----------
ALTER TABLE organizations
    ADD COLUMN suspended_at timestamptz,
    ADD COLUMN suspension_reason text,
    ADD CONSTRAINT organizations_suspension_consistent
        CHECK ((suspended_at IS NULL) = (suspension_reason IS NULL));

-- ---------- أحداث الفوترة ----------
CREATE TABLE billing_events (
    id                  bigserial PRIMARY KEY,
    org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    subscription_id     uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
    event_type          varchar(20) NOT NULL
        CHECK (event_type IN ('TRIAL_STARTED','TRIAL_EXTENDED','PAYMENT','PLAN_CHANGED','CANCELED','REACTIVATED')),
    plan_tier           varchar(30) REFERENCES plans(tier),
    amount_sar          numeric(10,2),
    period_months       smallint,
    reference           varchar(100),            -- رقم الفاتورة أو التحويل
    note                text,
    actor_user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    -- COALESCE ضروري: المقارنة مع NULL تعطي NULL فيمرّ القيد دون أن يُطبَّق
    CHECK (event_type <> 'PAYMENT' OR (COALESCE(amount_sar, 0) > 0 AND COALESCE(period_months, 0) > 0))
);
CREATE INDEX idx_billing_events_org ON billing_events(org_id, created_at DESC);

ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON billing_events
    USING (org_id = app.current_org_id()) WITH CHECK (org_id = app.current_org_id());

-- العميل يقرأ فواتيره فقط ولا يكتبها؛ فريق حصيف يكتب.
GRANT SELECT ON billing_events TO haseef_app;
GRANT SELECT, INSERT ON billing_events TO haseef_platform;
GRANT USAGE, SELECT ON SEQUENCE billing_events_id_seq TO haseef_platform;

-- ---------- سجل التدقيق: فهرس للفاعل ----------
CREATE INDEX idx_audit_log_actor ON audit_log(actor_user_id, created_at DESC);
