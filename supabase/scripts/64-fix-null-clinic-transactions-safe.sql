-- =============================================================================
-- تصحيح آمن لحركات transactions بلا clinic_id — يتعامل مع حالتين:
--   أ) حركة NULL بلا نظير — تحديث clinic_id فقط (آمن)
--   ب) حركة NULL هي في الحقيقة "مكرّرة" لحركة أخرى موجودة أصلاً بنفس
--      (clinic_id, reference_type, reference_id) — قيد التفرّد بيرفضها لو
--      حاولنا نحدّث clinic_id لأنها كانت مسجّلة مرتين فعلياً (خصم/إضافة
--      مضاعفة). هذي الحالة تحتاج حذف الصف المكرّر (NULL) لا تحديثه، لأن
--      الصف الصحيح موجود أصلاً ويحمل نفس المبلغ.
-- كل قسم يعرض النتيجة قبل أي تعديل — لا تنفّذ قسم 3 أو 4 إلا بعد مراجعتي.
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) حركات NULL التي "تتعارض" مع حركة موجودة أصلاً (نفس العيادة المتوقعة +
--    نفس reference_type + reference_id) — هذي مكرّرة فعلاً، ليست ناقصة فقط
-- ═══════════════════════════════════════════════════════════════════════════
WITH null_rows AS (
  SELECT
    t.id,
    t.type,
    t.amount,
    t.doctor_id,
    t.reference_type,
    t.reference_id,
    t.transaction_date,
    COALESCE(d.clinic_id, pr.clinic_id) AS derived_clinic_id
  FROM public.transactions t
  LEFT JOIN public.doctors d ON d.id = t.doctor_id
  LEFT JOIN public.payroll_records pr
    ON t.reference_id IS NOT NULL
    AND (
      pr.id::text = split_part(t.reference_id, ':from:', 1)
      OR pr.id::text = replace(t.reference_id, 'salary-entry:', '')
    )
  WHERE t.clinic_id IS NULL
)
SELECT
  nr.id AS null_row_id,
  nr.type,
  nr.amount AS null_row_amount,
  nr.doctor_id,
  nr.derived_clinic_id,
  nr.reference_type,
  nr.reference_id,
  nr.transaction_date AS null_row_date,
  dup.id AS existing_duplicate_id,
  dup.amount AS existing_duplicate_amount,
  dup.transaction_date AS existing_duplicate_date
FROM null_rows nr
JOIN public.transactions dup
  ON dup.clinic_id = nr.derived_clinic_id
  AND dup.reference_type = nr.reference_type
  AND dup.reference_id = nr.reference_id
  AND dup.id <> nr.id
ORDER BY nr.transaction_date;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) حركات NULL بلا أي تعارض — آمنة للتحديث المباشر
-- ═══════════════════════════════════════════════════════════════════════════
WITH null_rows AS (
  SELECT
    t.id,
    t.type,
    t.amount,
    t.doctor_id,
    t.reference_type,
    t.reference_id,
    t.transaction_date,
    COALESCE(d.clinic_id, pr.clinic_id) AS derived_clinic_id
  FROM public.transactions t
  LEFT JOIN public.doctors d ON d.id = t.doctor_id
  LEFT JOIN public.payroll_records pr
    ON t.reference_id IS NOT NULL
    AND (
      pr.id::text = split_part(t.reference_id, ':from:', 1)
      OR pr.id::text = replace(t.reference_id, 'salary-entry:', '')
    )
  WHERE t.clinic_id IS NULL
)
SELECT nr.*
FROM null_rows nr
WHERE nr.derived_clinic_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.transactions dup
    WHERE dup.clinic_id = nr.derived_clinic_id
      AND dup.reference_type = nr.reference_type
      AND dup.reference_id = nr.reference_id
      AND dup.id <> nr.id
  )
ORDER BY nr.transaction_date;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) التحديث الآمن — عبر الطبيب (doctor_id) فقط الحركات بلا تعارض — نفّذ
--    بعد المراجعة
-- ═══════════════════════════════════════════════════════════════════════════
-- UPDATE public.transactions t
-- SET clinic_id = d.clinic_id
-- FROM public.doctors d
-- WHERE t.doctor_id = d.id
--   AND t.clinic_id IS NULL
--   AND d.clinic_id IS NOT NULL
--   AND NOT EXISTS (
--     SELECT 1 FROM public.transactions dup
--     WHERE dup.clinic_id = d.clinic_id
--       AND dup.reference_type = t.reference_type
--       AND dup.reference_id = t.reference_id
--       AND dup.id <> t.id
--   );

-- ═══════════════════════════════════════════════════════════════════════════
-- 3-ب) التحديث الآمن — عبر payroll_records (بلا doctor_id) — للحركات بلا
--       تعارض فقط — نفّذ بعد المراجعة
-- ═══════════════════════════════════════════════════════════════════════════
-- UPDATE public.transactions t
-- SET clinic_id = pr.clinic_id
-- FROM public.payroll_records pr
-- WHERE t.clinic_id IS NULL
--   AND t.doctor_id IS NULL
--   AND t.reference_id IS NOT NULL
--   AND (
--     pr.id::text = split_part(t.reference_id, ':from:', 1)
--     OR pr.id::text = replace(t.reference_id, 'salary-entry:', '')
--   )
--   AND pr.clinic_id IS NOT NULL
--   AND NOT EXISTS (
--     SELECT 1 FROM public.transactions dup
--     WHERE dup.clinic_id = pr.clinic_id
--       AND dup.reference_type = t.reference_type
--       AND dup.reference_id = t.reference_id
--       AND dup.id <> t.id
--   );

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) حذف الحركات المكرّرة (NULL) بعد التأكد من القسم 1 — لا تنفّذ إلا بعد
--    موافقتي الصريحة على القائمة (كل صف بالقسم 1 له نظير صحيح بنفس المبلغ)
-- ═══════════════════════════════════════════════════════════════════════════
-- DELETE FROM public.transactions t
-- WHERE t.clinic_id IS NULL
--   AND EXISTS (
--     SELECT 1 FROM public.transactions dup
--     JOIN public.doctors d ON d.id = t.doctor_id
--     WHERE dup.clinic_id = d.clinic_id
--       AND dup.reference_type = t.reference_type
--       AND dup.reference_id = t.reference_id
--       AND dup.id <> t.id
--   );
