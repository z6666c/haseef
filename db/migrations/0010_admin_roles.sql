-- =====================================================================
-- 0010 — أدوار فريق حصيف بصلاحيات قابلة للتخصيص
--   الأدوار الثلاثة الأساسية تبقى (المدير العام لا يُعدَّل)، ويستطيع المدير العام إنشاء أدوار
--   بمسميات جديدة ويختار صلاحياتها من قائمة ثابتة يفهمها الخادم.
-- =====================================================================
CREATE TABLE admin_roles (
    code            varchar(40) PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
    name            varchar(80) NOT NULL UNIQUE,
    description     text,
    permissions     text[] NOT NULL DEFAULT '{}',
    is_system       boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      uuid REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO admin_roles (code, name, description, permissions, is_system) VALUES
 ('SUPER_ADMIN', 'المدير العام', 'كل الصلاحيات، ولا تُعدَّل', '{}', true),
 ('SUPPORT', 'الدعم الفني', 'إنشاء المنشآت وتعديلها وإدارة مستخدميها، والمحتوى، والاستشارات، دون الأرقام المالية',
   ARRAY['overview.view','orgs.view','orgs.manage','trials.manage','alerts.view','legal.cases','content.manage','usage.view','team.view','audit.view'], true),
 ('BILLING', 'المحاسبة', 'الاشتراكات والدفعات والباقات وتسعير الاستشارات، دون بيانات العملاء التشغيلية',
   ARRAY['overview.view','finance.view','billing.manage','legal.billing','usage.view','audit.view'], true);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_platform_role_check;
ALTER TABLE users ALTER COLUMN platform_role TYPE varchar(40);
ALTER TABLE users ADD CONSTRAINT users_platform_role_fk
    FOREIGN KEY (platform_role) REFERENCES admin_roles(code) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE admin_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_roles FORCE ROW LEVEL SECURITY;
REVOKE ALL ON admin_roles FROM haseef_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON admin_roles TO haseef_platform;
