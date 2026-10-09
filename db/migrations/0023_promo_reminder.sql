-- 0023: تذكير قبل انتهاء الشهر المجاني لعرض الإطلاق بخمسة أيام (مرة واحدة لكل منشأة)
ALTER TABLE promotion_redemptions ADD COLUMN reminded_at timestamptz;
GRANT UPDATE (reminded_at) ON promotion_redemptions TO haseef_platform;
