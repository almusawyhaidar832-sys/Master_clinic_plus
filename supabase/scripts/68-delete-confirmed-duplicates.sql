-- =============================================================================
-- حذف نهائي للحركات المكرّرة المؤكّدة (14 صف) — بالـ ID الصريح فقط، تمت
-- مراجعتها يدوياً واحدة واحدة. يبقى صف واحد أصلي لكل مجموعة.
-- مجموعة 21641ef9 (راتب موظف) استُثنيت عمداً — ليست تكراراً متطابقاً.
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 0) معاينة أخيرة قبل الحذف — تأكد أن هذي الـ 14 صف موجودة وبنفس البيانات
-- ═══════════════════════════════════════════════════════════════════════════
SELECT id, type, amount, doctor_id, reference_type, reference_id,
       transaction_date, description_ar
FROM public.transactions
WHERE id IN (
  '677ccf0c-efb1-4571-be6b-1962be183fc5', -- doctor_expense_clinic مكرر
  '0975e71a-dade-4712-90a0-c300222ce9b1', -- doctor_expense_doctor مكرر (دكتور احمد)
  '68069d7d-3790-4e6c-b4f0-6072b4d95d71', -- assistant_payroll_clinic (ساره) مكرر 1
  '5a3c9fb4-0436-4f65-a0ed-fdf7824af798', -- assistant_payroll_clinic (ساره) مكرر 2
  'cdaada66-86b2-4f06-b3ab-d5e7ad711e91', -- assistant_payroll_clinic (امجد) مكرر 1
  'c16db9dd-e314-423e-84fa-c560a1191f2f', -- assistant_payroll_clinic (امجد) مكرر 2
  '4411a07d-b268-46cf-b600-589b742f0d5b', -- staff_salary_accrual (3de006f7) مكرر 1
  '89906714-9c19-4bae-87d0-5dcf357df4fb', -- staff_salary_accrual (3de006f7) مكرر 2
  '27d2c817-d34d-4514-8a51-669d1082fa7e', -- staff_salary_accrual (5887d432) مكرر 1
  'cff019fa-df1f-43ad-9116-30e22686579a', -- staff_salary_accrual (5887d432) مكرر 2
  '510c0a3e-e388-422a-8638-0cc96cb2dc70', -- staff_salary_accrual (f82d049e) مكرر 1
  'e9b1ea03-21d7-40ca-8b49-556e35e46ce3', -- staff_salary_accrual (f82d049e) مكرر 2
  'ba55f263-f5bc-4960-9fc0-c557ab2428f0', -- staff_salary_accrual (f19b5df2) القديم الخاطئ 600000
  'deca4e02-4411-4d0f-81ad-a097d0e199ed'  -- staff_salary_accrual (f19b5df2) مكرر 550000
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) الحذف الفعلي — نفّذ فقط بعد مراجعة القسم 0 والتأكد إنها نفس الـ 14 صف
-- ═══════════════════════════════════════════════════════════════════════════
DELETE FROM public.transactions
WHERE id IN (
  '677ccf0c-efb1-4571-be6b-1962be183fc5',
  '0975e71a-dade-4712-90a0-c300222ce9b1',
  '68069d7d-3790-4e6c-b4f0-6072b4d95d71',
  '5a3c9fb4-0436-4f65-a0ed-fdf7824af798',
  'cdaada66-86b2-4f06-b3ab-d5e7ad711e91',
  'c16db9dd-e314-423e-84fa-c560a1191f2f',
  '4411a07d-b268-46cf-b600-589b742f0d5b',
  '89906714-9c19-4bae-87d0-5dcf357df4fb',
  '27d2c817-d34d-4514-8a51-669d1082fa7e',
  'cff019fa-df1f-43ad-9116-30e22686579a',
  '510c0a3e-e388-422a-8638-0cc96cb2dc70',
  'e9b1ea03-21d7-40ca-8b49-556e35e46ce3',
  'ba55f263-f5bc-4960-9fc0-c557ab2428f0',
  'deca4e02-4411-4d0f-81ad-a097d0e199ed'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) تحقّق ما تبقّى بلا clinic_id بعد الحذف — تمهيداً للباكفيل التالي
-- ═══════════════════════════════════════════════════════════════════════════
SELECT type, COUNT(*) AS remaining_null
FROM public.transactions
WHERE clinic_id IS NULL
GROUP BY type
ORDER BY remaining_null DESC;
