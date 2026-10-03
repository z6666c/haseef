-- 0011: فهرس جزئي لحساب محاولات الدخول الفاشلة لكل بريد (الحماية من تخمين كلمات المرور).
CREATE INDEX IF NOT EXISTS idx_audit_login_failed
    ON audit_log ((changes->>'email'), created_at DESC) WHERE action = 'LOGIN_FAILED';
