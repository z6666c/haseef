-- 0024: الجزاءات وفق جدول لائحة تنظيم العمل، والتمييز بين حسم أجر المدة والجزاء والإنذار
--   * طريقة المنشأة: REGULATION (المدة + جزاء متدرج بالتكرار، الافتراضي) أو DURATION (حسم أجر المدة فقط)
--   * أجر اليوم من الأجر الفعلي (الأساسي + السكن + البدلات الأخرى) ÷ 30، أو حسب اختيار المنشأة
--   * نافذة تكرار التأخر (الافتراضي 180 يوماً)، والغياب خلال السنة العقدية

ALTER TABLE org_employees ADD COLUMN other_allowances numeric(10,2) NOT NULL DEFAULT 0 CHECK (other_allowances >= 0);

ALTER TABLE hr_settings
    ADD COLUMN deduction_method varchar(10) NOT NULL DEFAULT 'REGULATION' CHECK (deduction_method IN ('REGULATION','DURATION')),
    ADD COLUMN wage_base varchar(13) NOT NULL DEFAULT 'TOTAL' CHECK (wage_base IN ('BASIC','BASIC_HOUSING','TOTAL')),
    ADD COLUMN late_repeat_days smallint NOT NULL DEFAULT 180 CHECK (late_repeat_days BETWEEN 30 AND 365);

ALTER TABLE deduction_notices
    ADD COLUMN nature varchar(7),
    ADD COLUMN bracket varchar(12),
    ADD COLUMN occurrence smallint CHECK (occurrence IS NULL OR occurrence BETWEEN 1 AND 99),
    ADD COLUMN disrupted boolean NOT NULL DEFAULT false;
UPDATE deduction_notices SET nature = CASE WHEN kind IN ('ABSENCE','LATE_RETURN') THEN 'WAGE' ELSE 'PENALTY' END;
ALTER TABLE deduction_notices
    ALTER COLUMN nature SET NOT NULL,
    ALTER COLUMN nature SET DEFAULT 'PENALTY',
    ADD CONSTRAINT deduction_nature_chk CHECK (nature IN ('WAGE','PENALTY','WARNING')),
    DROP CONSTRAINT deduction_notices_amount_check,
    ADD CONSTRAINT deduction_amount_chk CHECK ((nature = 'WARNING' AND amount = 0) OR (nature <> 'WARNING' AND amount > 0));
CREATE INDEX idx_deduction_notices_repeat ON deduction_notices(employee_id, bracket, incident_date) WHERE bracket IS NOT NULL;
