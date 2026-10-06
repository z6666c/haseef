-- 0016: وحدة العمل والموظفين كاملة في كل الباقات (سجل الموظفين والحاسبة ومؤشرات قوى، لا التقويم وحده).
UPDATE plans SET features = array_append(features, 'LABOR_HR') WHERE NOT ('LABOR_HR' = ANY(features));
