-- =============================================================================
-- فحص: هل حركات خصم راتب المساعد من محفظة الطبيب (assistant_payroll_doctor)
-- محفوظة بنفس clinic_id الحالي للطبيب؟ لو لا، هذا سبب اختفاء الخصم بالموبايل
-- (بينما تبقى قاعدة البيانات صحيحة لأنها لا تفلتر بـ clinic_id)
-- قراءة فقط — بدون تعديل بيانات
-- =============================================================================
SELECT
  d.full_name_ar AS doctor_name,
  d.clinic_id AS doctor_current_clinic_id,
  c1.name_ar AS doctor_current_clinic_name,
  t.id AS tx_id,
  t.clinic_id AS tx_clinic_id,
  c2.name_ar AS tx_clinic_name,
  t.amount,
  t.type,
  t.reference_id,
  t.transaction_date,
  (t.clinic_id = d.clinic_id) AS clinic_matches
FROM public.transactions t
JOIN public.doctors d ON d.id = t.doctor_id
LEFT JOIN public.clinics c1 ON c1.id = d.clinic_id
LEFT JOIN public.clinics c2 ON c2.id = t.clinic_id
WHERE t.type = 'assistant_payroll_doctor'
  AND (d.full_name_ar ILIKE '%سجاد%' OR d.full_name_ar ILIKE '%حارث%' OR d.full_name_ar ILIKE '%عباس%')
ORDER BY d.full_name_ar, t.transaction_date;
