-- 0021: تحديث التسعير (الربع الرابع 2026)
--   * الباقات +10%: الأساس 219، الحوكمة والنمو 549، كبار العملاء 1,429 (السنوي = 10 أشهر)
--   * إضافة الموارد البشرية (حضور + إجازات + خصومات) بشريحتين حسب عدد الموظفين: 149 حتى 25، و249 حتى 75
--   * حزمة الموظفين: الموارد البشرية + بوت الواتساب بـ199 حتى 25 موظفاً
--   * إضافة الشريحة/الحزمة «تمنح» إضافات أخرى (limits.grants)، وكبار العملاء تشمل الكل مجاناً
-- الاشتراكات القائمة تبقى على ما دُفع حتى التجديد.

UPDATE plans SET monthly_price_sar = 219,  yearly_price_sar = 2190  WHERE tier = 'ESSENTIAL';
UPDATE plans SET monthly_price_sar = 549,  yearly_price_sar = 5490  WHERE tier = 'PROFESSIONAL_GRC';
UPDATE plans SET monthly_price_sar = 1429, yearly_price_sar = 14290 WHERE tier = 'ENTERPRISE';

UPDATE addon_catalog SET name = 'الموارد البشرية — حتى 25 موظفاً', monthly_price = 149,
       limits = '{"members": 25, "included_unlimited": true}'
 WHERE code = 'ATTENDANCE';

INSERT INTO addon_catalog (code, name, monthly_price, included_tiers, limits) VALUES
 ('ATTENDANCE_75', 'الموارد البشرية — حتى 75 موظفاً', 249, '{ENTERPRISE}',
  '{"members": 75, "included_unlimited": true, "grants": ["ATTENDANCE"]}'),
 ('STAFF_BUNDLE', 'حزمة الموظفين: الموارد البشرية + بوت الواتساب — حتى 25 موظفاً', 199, '{ENTERPRISE}',
  '{"members": 25, "questions": 1000, "included_unlimited": true, "grants": ["ATTENDANCE", "WA_BOT"]}')
ON CONFLICT (code) DO NOTHING;
