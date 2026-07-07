-- إصلاح خصم راتب المساعد: حصة الطبيب فقط من رصيده + حصة العيادة من الربح
--
-- المشكلة: doctor_share_amount = total_salary رغم نسبة 50% — يُخصم الكل من الطبيب
-- ولا تُسجَّل حصة العيادة في الربح.
-- الحل: مزامنة الحصص + إرجاع الزائد للطبيب + خصم حصة العيادة الناقصة.

-- 1) مزامنة السجلات غير المدفوعة
UPDATE public.payroll_records pr
SET
  doctor_share_percentage = a.doctor_share_percentage,
  doctor_share_amount = ROUND(pr.total_salary * a.doctor_share_percentage / 100, 2),
  clinic_share_amount = ROUND(
    pr.total_salary - ROUND(pr.total_salary * a.doctor_share_percentage / 100, 2),
    2
  )
FROM public.assistants a
WHERE pr.assistant_id = a.id
  AND pr.status <> 'paid'
  AND pr.total_salary > 0
  AND (
    ABS(
      pr.doctor_share_amount
      - ROUND(pr.total_salary * a.doctor_share_percentage / 100, 2)
    ) > 0.02
    OR pr.doctor_share_percentage IS DISTINCT FROM a.doctor_share_percentage
  );

-- 2) إرجاع الخصم الزائد من رصيد الطبيب (قبل تعديل paid_*)
INSERT INTO public.transactions (
  id,
  clinic_id,
  doctor_id,
  amount,
  type,
  description_ar,
  transaction_date,
  reference_type,
  reference_id
)
SELECT
  gen_random_uuid(),
  pr.clinic_id,
  pr.doctor_id,
  ROUND(
    pr.paid_doctor_share_amount
    - ROUND(pr.total_salary * a.doctor_share_percentage / 100, 2),
    2
  ),
  'assistant_payroll_doctor',
  'تصحيح — خصم زائد لراتب مساعد ' || pr.assistant_name_ar || ' — ' || pr.month_year,
  CURRENT_DATE,
  'payroll_doctor_share_correction',
  pr.id::TEXT
FROM public.payroll_records pr
JOIN public.assistants a ON a.id = pr.assistant_id
WHERE pr.status = 'paid'
  AND pr.total_salary > 0
  AND a.doctor_share_percentage < 100
  AND pr.paid_doctor_share_amount
    > ROUND(pr.total_salary * a.doctor_share_percentage / 100, 2) + 0.02
  AND NOT EXISTS (
    SELECT 1
    FROM public.transactions t
    WHERE t.clinic_id = pr.clinic_id
      AND t.reference_type = 'payroll_doctor_share_correction'
      AND t.reference_id = pr.id::TEXT
  );

-- 3) خصم حصة العيادة الناقصة من الربح (قبل تعديل paid_*)
INSERT INTO public.transactions (
  id,
  clinic_id,
  doctor_id,
  amount,
  type,
  description_ar,
  transaction_date,
  reference_type,
  reference_id
)
SELECT
  gen_random_uuid(),
  pr.clinic_id,
  NULL,
  -ROUND(
    ROUND(
      pr.total_salary - ROUND(pr.total_salary * a.doctor_share_percentage / 100, 2),
      2
    ) - pr.paid_clinic_share_amount,
    2
  ),
  'assistant_payroll_clinic',
  'تصحيح — حصة عيادة مساعد ' || pr.assistant_name_ar || ' — ' || pr.month_year,
  CURRENT_DATE,
  'payroll_clinic_share_correction',
  pr.id::TEXT
FROM public.payroll_records pr
JOIN public.assistants a ON a.id = pr.assistant_id
WHERE pr.status = 'paid'
  AND pr.total_salary > 0
  AND a.doctor_share_percentage < 100
  AND pr.paid_clinic_share_amount + 0.02 <
    ROUND(
      pr.total_salary - ROUND(pr.total_salary * a.doctor_share_percentage / 100, 2),
      2
    )
  AND NOT EXISTS (
    SELECT 1
    FROM public.transactions t
    WHERE t.clinic_id = pr.clinic_id
      AND t.reference_type = 'payroll_clinic_share_correction'
      AND t.reference_id = pr.id::TEXT
  );

-- 4) تصحيح الحصص والمبالغ المؤكَّدة في السجلات المدفوعة
UPDATE public.payroll_records pr
SET
  doctor_share_percentage = a.doctor_share_percentage,
  doctor_share_amount = ROUND(pr.total_salary * a.doctor_share_percentage / 100, 2),
  clinic_share_amount = ROUND(
    pr.total_salary - ROUND(pr.total_salary * a.doctor_share_percentage / 100, 2),
    2
  ),
  paid_doctor_share_amount = ROUND(pr.total_salary * a.doctor_share_percentage / 100, 2),
  paid_clinic_share_amount = ROUND(
    pr.total_salary - ROUND(pr.total_salary * a.doctor_share_percentage / 100, 2),
    2
  )
FROM public.assistants a
WHERE pr.assistant_id = a.id
  AND pr.status = 'paid'
  AND pr.total_salary > 0
  AND (
    pr.paid_doctor_share_amount
      > ROUND(pr.total_salary * a.doctor_share_percentage / 100, 2) + 0.02
    OR pr.paid_clinic_share_amount + 0.02 <
      ROUND(
        pr.total_salary - ROUND(pr.total_salary * a.doctor_share_percentage / 100, 2),
        2
      )
    OR ABS(
      pr.doctor_share_amount
      - ROUND(pr.total_salary * a.doctor_share_percentage / 100, 2)
    ) > 0.02
  );

NOTIFY pgrst, 'reload schema';
