-- =============================================================================
-- تشخيص شامل: حركات transactions بدون clinic_id (NULL) بكل النظام — السبب
-- الحقيقي لاختفاء خصم رواتب المساعدين من رصيد الموبايل (يفلتر بـ clinic_id
-- بينما قاعدة البيانات تفلتر بـ doctor_id فقط، فتختلف النتيجة)
-- القسم 1-2 قراءة فقط. القسم 3 فيه UPDATE فعلي — نفّذه بعد مراجعة 1-2.
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) عدد الحركات بلا clinic_id لكل نوع (type) — عبر كل النظام
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  type,
  COUNT(*) AS null_clinic_count,
  MIN(transaction_date) AS earliest,
  MAX(transaction_date) AS latest,
  ROUND(SUM(amount), 2) AS sum_amount
FROM public.transactions
WHERE clinic_id IS NULL
GROUP BY type
ORDER BY null_clinic_count DESC;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) تفصيل كل حركة بلا clinic_id مع الطبيب/العيادة المتوقّعة (لو عندها doctor_id)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  t.id,
  t.type,
  t.amount,
  t.doctor_id,
  d.full_name_ar AS doctor_name,
  d.clinic_id AS expected_clinic_id_from_doctor,
  c.name_ar AS expected_clinic_name,
  t.reference_type,
  t.reference_id,
  t.transaction_date
FROM public.transactions t
LEFT JOIN public.doctors d ON d.id = t.doctor_id
LEFT JOIN public.clinics c ON c.id = d.clinic_id
WHERE t.clinic_id IS NULL
ORDER BY t.transaction_date;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) التصحيح — نفّذ فقط بعد مراجعة الأقسام 1 و2 وإرسال نتائجهما لي
--    آ) حركات فيها doctor_id: نأخذ clinic_id من doctors.clinic_id
--    ب) حركات بلا doctor_id (مثل assistant_payroll_clinic): نحاول من
--       payroll_records عبر reference_id (الجزء قبل ":from:" أو الجزء بعد
--       "salary-entry:")
--    كل جملة UPDATE تتنفّذ وتُثبَّت (commit) فوراً في محرر Supabase — لا يوجد
--    تراجع تلقائي، لذلك لا تشغّل هذا القسم إلا بعد تأكيدي الصريح.
-- ═══════════════════════════════════════════════════════════════════════════

-- 3-آ) عبر الطبيب مباشرة
UPDATE public.transactions t
SET clinic_id = d.clinic_id
FROM public.doctors d
WHERE t.doctor_id = d.id
  AND t.clinic_id IS NULL
  AND d.clinic_id IS NOT NULL;

-- 3-ب) عبر payroll_records (يغطي assistant_payroll_clinic والباقي بلا doctor_id)
UPDATE public.transactions t
SET clinic_id = pr.clinic_id
FROM public.payroll_records pr
WHERE t.clinic_id IS NULL
  AND t.reference_id IS NOT NULL
  AND (
    pr.id::text = split_part(t.reference_id, ':from:', 1)
    OR pr.id::text = replace(t.reference_id, 'salary-entry:', '')
  )
  AND pr.clinic_id IS NOT NULL;

-- 3-ج) تحقّق ما تبقّى بلا clinic_id (المفروض صفر أو قريب من صفر)
SELECT type, COUNT(*) AS still_null
FROM public.transactions
WHERE clinic_id IS NULL
GROUP BY type;
