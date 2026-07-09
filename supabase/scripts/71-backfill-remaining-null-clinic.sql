-- =============================================================================
-- باكفيل شامل نهائي لـ clinic_id — لكل الأنواع المتبقية، كل نوع مربوط
-- بالجدول الصحيح المصدر له. شغّل هذا بعد سكربت 68 (حذف التكرارات) و70
-- (حذف شحنات العيادة الشبح). كل خطوة فيها فحصا أمان:
--   أ) NOT EXISTS — يمنع تعارض مع صف موجود أصلاً بـ clinic_id صحيح
--   ب) عدد الصفوف NULL بنفس reference_type+reference_id = 1 فقط — يمنع
--      تعارض صف مع "أخوه" NULL (مثل حالة مجموعة 21641ef9 المستثناة عمداً)
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 0) معاينة قبل أي تعديل — العدد الكلي بلا clinic_id الآن
-- ═══════════════════════════════════════════════════════════════════════════
SELECT type, COUNT(*) AS null_count
FROM public.transactions
WHERE clinic_id IS NULL
GROUP BY type
ORDER BY null_count DESC;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) حركات فيها doctor_id مباشرة — assistant_payroll_doctor،
--    doctor_expense_doctor، doctor_salary_paid
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE public.transactions t
SET clinic_id = d.clinic_id
FROM public.doctors d
WHERE t.doctor_id = d.id
  AND t.clinic_id IS NULL
  AND d.clinic_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.transactions dup
    WHERE dup.clinic_id = d.clinic_id
      AND dup.reference_type = t.reference_type
      AND dup.reference_id = t.reference_id
      AND dup.id <> t.id
  )
  AND (
    SELECT COUNT(*) FROM public.transactions sib
    WHERE sib.clinic_id IS NULL
      AND sib.reference_type = t.reference_type
      AND sib.reference_id = t.reference_id
  ) = 1;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) assistant_payroll_clinic — عبر payroll_records أو salary_entries
--    (parent id = الجزء قبل أول ':' أو بعد 'salary-entry:')، مع احتياط:
--    الحصة الأخرى بنفس reference_id (assistant_payroll_doctor) لو موجودة
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE public.transactions t
SET clinic_id = derived.clinic_id
FROM (
  SELECT
    t2.id,
    COALESCE(
      pr.clinic_id,
      se.clinic_id,
      (
        SELECT d2.clinic_id
        FROM public.transactions sib
        JOIN public.doctors d2 ON d2.id = sib.doctor_id
        WHERE sib.reference_id = t2.reference_id
          AND sib.doctor_id IS NOT NULL
        LIMIT 1
      )
    ) AS clinic_id
  FROM public.transactions t2
  LEFT JOIN public.payroll_records pr
    ON t2.reference_id IS NOT NULL
    AND pr.id::text = CASE
      WHEN t2.reference_id LIKE 'salary-entry:%' THEN NULL
      ELSE split_part(t2.reference_id, ':', 1)
    END
  LEFT JOIN public.salary_entries se
    ON t2.reference_id LIKE 'salary-entry:%'
    AND se.id::text = replace(t2.reference_id, 'salary-entry:', '')
  WHERE t2.type = 'assistant_payroll_clinic'
    AND t2.clinic_id IS NULL
) derived
WHERE t.id = derived.id
  AND derived.clinic_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.transactions dup
    WHERE dup.clinic_id = derived.clinic_id
      AND dup.reference_type = t.reference_type
      AND dup.reference_id = t.reference_id
      AND dup.id <> t.id
  )
  AND (
    SELECT COUNT(*) FROM public.transactions sib
    WHERE sib.clinic_id IS NULL
      AND sib.reference_type = t.reference_type
      AND sib.reference_id = t.reference_id
  ) = 1;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) doctor_expense_clinic — عبر doctor_expenses.id (بلا فصل، مطابقة مباشرة)
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE public.transactions t
SET clinic_id = de.clinic_id
FROM public.doctor_expenses de
WHERE t.type = 'doctor_expense_clinic'
  AND t.clinic_id IS NULL
  AND t.reference_id IS NOT NULL
  AND de.id::text = t.reference_id
  AND de.clinic_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.transactions dup
    WHERE dup.clinic_id = de.clinic_id
      AND dup.reference_type = t.reference_type
      AND dup.reference_id = t.reference_id
      AND dup.id <> t.id
  )
  AND (
    SELECT COUNT(*) FROM public.transactions sib
    WHERE sib.clinic_id IS NULL
      AND sib.reference_type = t.reference_type
      AND sib.reference_id = t.reference_id
  ) = 1;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) clinic_expense — عبر expenses.id (بلا فصل، مطابقة مباشرة)
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE public.transactions t
SET clinic_id = e.clinic_id
FROM public.expenses e
WHERE t.type = 'clinic_expense'
  AND t.clinic_id IS NULL
  AND t.reference_id IS NOT NULL
  AND e.id::text = t.reference_id
  AND e.clinic_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.transactions dup
    WHERE dup.clinic_id = e.clinic_id
      AND dup.reference_type = t.reference_type
      AND dup.reference_id = t.reference_id
      AND dup.id <> t.id
  )
  AND (
    SELECT COUNT(*) FROM public.transactions sib
    WHERE sib.clinic_id IS NULL
      AND sib.reference_type = t.reference_type
      AND sib.reference_id = t.reference_id
  ) = 1;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) staff_salary_accrual / staff_salary_paid — عبر salary_slips.id
--    (الجزء قبل أول ':' لو فيه لاحقة). يستثني تلقائياً مجموعة 21641ef9
--    (فيها صفّين NULL بنفس المرجع — شرط "sib count = 1" يستثنيها).
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE public.transactions t
SET clinic_id = ss.clinic_id
FROM public.salary_slips ss
WHERE t.type IN ('staff_salary_accrual', 'staff_salary_paid')
  AND t.clinic_id IS NULL
  AND t.reference_id IS NOT NULL
  AND ss.id::text = split_part(t.reference_id, ':', 1)
  AND ss.clinic_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.transactions dup
    WHERE dup.clinic_id = ss.clinic_id
      AND dup.reference_type = t.reference_type
      AND dup.reference_id = t.reference_id
      AND dup.id <> t.id
  )
  AND (
    SELECT COUNT(*) FROM public.transactions sib
    WHERE sib.clinic_id IS NULL
      AND sib.reference_type = t.reference_type
      AND sib.reference_id = t.reference_id
  ) = 1;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) تحقّق نهائي — كل ما تبقّى بلا clinic_id (المفروض قليل جداً أو صفر،
--    ما عدا مجموعة 21641ef9 المستثناة عمداً)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT id, type, amount, doctor_id, reference_type, reference_id,
       transaction_date, description_ar
FROM public.transactions
WHERE clinic_id IS NULL
ORDER BY type, transaction_date;
