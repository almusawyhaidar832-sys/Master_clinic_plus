-- =============================================================================
-- عيّنة من كل نوع حركة لسه بلا clinic_id — لتصميم طريقة استخراج clinic_id
-- الصحيحة لكل نوع (عبر doctor_id أو reference_id أو جدول آخر)
-- قراءة فقط
-- =============================================================================
SELECT
  t.type,
  t.id,
  t.doctor_id,
  t.patient_id,
  t.operation_id,
  t.reference_type,
  t.reference_id,
  t.amount,
  t.transaction_date,
  t.description_ar
FROM public.transactions t
WHERE t.clinic_id IS NULL
ORDER BY t.type, t.transaction_date;
