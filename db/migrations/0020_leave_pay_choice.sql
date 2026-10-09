-- 0020: الأجر في الإجازة الاعتيادية والاضطرارية: مدفوعة أو بدون أجر أو باختيار الموظف في كل طلب
--   * سياسة كل نوع: PAID دائماً مدفوعة، UNPAID دائماً بدون أجر، CHOICE يختار الموظف عند الطلب (والموارد البشرية تعدّله عند البت)
--   * المدفوعة من نوع «يُخصم من الرصيد» تُخصم من رصيد الإجازة السنوية، وغير المدفوعة لا تمس الرصيد وتظهر في استقطاعات الشهر

ALTER TABLE hr_leave_policies ADD COLUMN pay_mode varchar(6) NOT NULL DEFAULT 'PAID' CHECK (pay_mode IN ('PAID','UNPAID','CHOICE'));
UPDATE hr_leave_policies SET pay_mode = CASE WHEN leave_type IN ('REGULAR','EMERGENCY') THEN 'CHOICE' WHEN is_paid THEN 'PAID' ELSE 'UNPAID' END;
UPDATE hr_leave_policies SET from_balance = true WHERE leave_type IN ('REGULAR','EMERGENCY');

ALTER TABLE leave_requests ADD COLUMN is_paid boolean;
UPDATE leave_requests l SET is_paid = COALESCE((SELECT p.is_paid FROM hr_leave_policies p WHERE p.org_id = l.org_id AND p.leave_type = l.leave_type), true);
ALTER TABLE leave_requests ALTER COLUMN is_paid SET NOT NULL, ALTER COLUMN is_paid SET DEFAULT true;
