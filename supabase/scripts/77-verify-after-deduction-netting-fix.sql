-- =============================================================================
-- تحقق نهائي بعد سكربت 76 (إصلاح صافي الخصومات) — حارث وسجاد ومحمد عباس
-- =============================================================================
-- شغّل هذا فقط بعد تنفيذ 76-fix-deduction-netting-for-corrections.sql بنجاح.
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) الرصيد الرسمي الحالي (من القاعدة) — لكل الأطباء الثلاثة
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  d.full_name_ar,
  d.percentage,
  d.payment_type,
  public.get_doctor_wallet_stats(d.id) AS wallet
FROM public.doctors d
WHERE d.full_name_ar ILIKE '%حارث%'
   OR d.full_name_ar ILIKE '%سجاد%'
   OR d.full_name_ar ILIKE '%عباس%'
ORDER BY d.full_name_ar;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) تفصيل صافي حركات assistant_payroll_doctor لكل طبيب — للتحقق اليدوي
--    (يجب أن يطابق payroll_deductions أعلاه)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  d.full_name_ar,
  t.type,
  COALESCE(SUM(t.amount), 0) AS net_signed_sum,
  GREATEST(0, -COALESCE(SUM(t.amount), 0)) AS correct_deduction
FROM public.transactions t
JOIN public.doctors d ON d.id = t.doctor_id
WHERE (d.full_name_ar ILIKE '%حارث%'
   OR d.full_name_ar ILIKE '%سجاد%'
   OR d.full_name_ar ILIKE '%عباس%')
  AND t.type IN ('assistant_payroll_doctor', 'doctor_expense_doctor')
GROUP BY d.full_name_ar, t.type
ORDER BY d.full_name_ar, t.type;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) هل توجد حركات تصحيح موجبة أخرى (assistant_payroll_doctor/clinic أو
--    doctor_expense_doctor/clinic) في كل النظام؟ — لمعرفة نطاق التأثير الكامل
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  d.full_name_ar AS doctor_name,
  c.name_ar AS clinic_name,
  t.type,
  t.amount,
  t.description_ar,
  t.transaction_date
FROM public.transactions t
LEFT JOIN public.doctors d ON d.id = t.doctor_id
LEFT JOIN public.clinics c ON c.id = t.clinic_id
WHERE t.type IN (
    'assistant_payroll_doctor', 'assistant_payroll_clinic',
    'doctor_expense_doctor', 'doctor_expense_clinic'
  )
  AND t.amount > 0
ORDER BY t.transaction_date DESC;
