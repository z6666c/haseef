-- 0025: تراخيص الأنشطة القطاعية وسياسة مكافحة التحرش
--   * مجال جديد SECTOR لتراخيص الأنشطة (الغذاء، الصحة، الاستثمار، السياحة، النقل، التعليم، الإعلام، التجارة الإلكترونية، المقاولات)
--   * نوع سياسة جديد ANTI_HARASSMENT
--   متطلبات كل التزام وخطواته محتوى في الكود (content/requirements.py) لا في القاعدة.

ALTER TABLE obligation_catalog DROP CONSTRAINT IF EXISTS obligation_catalog_domain_check;
ALTER TABLE obligation_catalog ADD CONSTRAINT obligation_catalog_domain_check
    CHECK (domain IN ('COMMERCIAL','MUNICIPAL','LABOR','TAX','SAFETY','PDPL','GOVERNANCE','AML','INSURANCE','SECTOR'));

ALTER TABLE internal_policies DROP CONSTRAINT IF EXISTS internal_policies_policy_type_check;
ALTER TABLE internal_policies ADD CONSTRAINT internal_policies_policy_type_check
    CHECK (policy_type IN ('PRIVACY_POLICY','CONFLICT_OF_INTEREST','WHISTLEBLOWING','CODE_OF_CONDUCT','DATA_RETENTION',
                           'INFOSEC','BREACH_RESPONSE','RELATED_PARTIES','BOARD_CHARTER','AUDIT_COMMITTEE_CHARTER',
                           'DISCLOSURE','DOA','RISK_MANAGEMENT','AML','WORK_REGULATION','HEALTH_SAFETY','ANTI_HARASSMENT','OTHER'));
