-- 0022: شريحة 200 موظف للموارد البشرية، وعرض الإطلاق (شهر مجاني لأول 50 مشتركاً)
--   * أكثر من 200 موظف: يُوجَّه العميل لباقة كبار العملاء (تشمل الإضافات بلا حد)
--   * العرض: مرة واحدة لكل منشأة باشتراك مدفوع ساري، ولمن لم يشترك في الموارد البشرية من قبل؛ يُفعَّل بالشريحة المناسبة لعدد موظفيها

INSERT INTO addon_catalog (code, name, monthly_price, included_tiers, limits) VALUES
 ('ATTENDANCE_200', 'الموارد البشرية — حتى 200 موظف', 399, '{ENTERPRISE}',
  '{"members": 200, "included_unlimited": true, "grants": ["ATTENDANCE"]}')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE promotions (
    code             varchar(30) PRIMARY KEY,
    name             varchar(150) NOT NULL,
    addon_family     varchar(20) NOT NULL CHECK (addon_family IN ('HR')),
    free_months      smallint NOT NULL DEFAULT 1 CHECK (free_months BETWEEN 1 AND 12),
    max_redemptions  integer NOT NULL CHECK (max_redemptions > 0),
    is_active        boolean NOT NULL DEFAULT true,
    ends_at          timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE promotion_redemptions (
    id               bigserial PRIMARY KEY,
    promo_code       varchar(30) NOT NULL REFERENCES promotions(code),
    org_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    addon_code       varchar(20) NOT NULL REFERENCES addon_catalog(code),
    paid_until       timestamptz NOT NULL,
    redeemed_by      uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (promo_code, org_id)
);

ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY promotions_read ON promotions FOR SELECT USING (true);
GRANT SELECT ON promotions TO haseef_app;
GRANT SELECT, INSERT, UPDATE ON promotions TO haseef_platform;

ALTER TABLE promotion_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotion_redemptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON promotion_redemptions FOR SELECT USING (org_id = app.current_org_id());
GRANT SELECT ON promotion_redemptions TO haseef_app;                 -- التفعيل من دور المنصة فقط
GRANT SELECT, INSERT ON promotion_redemptions TO haseef_platform;
GRANT USAGE ON SEQUENCE promotion_redemptions_id_seq TO haseef_platform;

INSERT INTO promotions (code, name, addon_family, free_months, max_redemptions) VALUES
 ('HR_LAUNCH', 'عرض الإطلاق: شهر مجاني على الموارد البشرية لأول 50 مشتركاً', 'HR', 1, 50);
