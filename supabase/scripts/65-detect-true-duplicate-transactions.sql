-- =============================================================================
-- كشف التكرارات الحقيقية بين حركات transactions (بلا clinic_id) — حركات
-- نفس reference_type + reference_id مسجّلة أكثر من مرة (خصم/إضافة مضاعفة
-- فعلية بسبب ثغرة فحص التكرار عندما كان clinic_id = NULL)
-- قراءة فقط — بدون أي تعديل بيانات
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) مجموعات NULL مكرّرة فيما بينها (أكثر من صف بنفس reference_type+id
--    وكلها clinic_id = NULL) — هذي تكرارات فعلية أدخلت مرتين أو أكثر
-- ═══════════════════════════════════════════════════════════════════════════
WITH null_rows AS (
  SELECT
    t.id, t.type, t.amount, t.doctor_id, t.reference_type, t.reference_id,
    t.transaction_date, t.description_ar, t.created_at
  FROM public.transactions t
  WHERE t.clinic_id IS NULL
),
grouped AS (
  SELECT
    reference_type,
    reference_id,
    COUNT(*) AS row_count,
    ARRAY_AGG(id ORDER BY created_at) AS ids,
    ARRAY_AGG(amount ORDER BY created_at) AS amounts,
    ARRAY_AGG(doctor_id ORDER BY created_at) AS doctor_ids,
    ARRAY_AGG(transaction_date ORDER BY created_at) AS dates,
    ARRAY_AGG(created_at ORDER BY created_at) AS created_ats
  FROM null_rows
  WHERE reference_id IS NOT NULL
  GROUP BY reference_type, reference_id
  HAVING COUNT(*) > 1
)
SELECT * FROM grouped ORDER BY row_count DESC;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) إجمالي أثر التكرار على كل طبيب (لو حذفنا كل نسخة زائدة عن الأولى لكل
--    مجموعة مكرّرة) — يوضّح كم رجع لمحفظة كل طبيب
-- ═══════════════════════════════════════════════════════════════════════════
WITH null_rows AS (
  SELECT
    t.id, t.type, t.amount, t.doctor_id, t.reference_type, t.reference_id,
    t.transaction_date, t.created_at,
    ROW_NUMBER() OVER (
      PARTITION BY t.reference_type, t.reference_id
      ORDER BY t.created_at, t.id
    ) AS rn
  FROM public.transactions t
  WHERE t.clinic_id IS NULL AND t.reference_id IS NOT NULL
),
duplicates AS (
  SELECT * FROM null_rows WHERE rn > 1
)
SELECT
  d.doctor_id,
  doc.full_name_ar AS doctor_name,
  c.name_ar AS clinic_name,
  d.type,
  COUNT(*) AS duplicate_rows_to_remove,
  ROUND(SUM(d.amount), 2) AS total_amount_to_reverse
FROM duplicates d
LEFT JOIN public.doctors doc ON doc.id = d.doctor_id
LEFT JOIN public.clinics c ON c.id = doc.clinic_id
GROUP BY d.doctor_id, doc.full_name_ar, c.name_ar, d.type
ORDER BY ABS(SUM(d.amount)) DESC;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) نفس الفكرة، لكن مقارنة NULL بمقابل صف موجود أصلاً بـ clinic_id صحيح
--    (نفس reference_type+id) — هذي حركة NULL هي تكرار لحركة مُسجَّلة صحيح
-- ═══════════════════════════════════════════════════════════════════════════
WITH null_rows AS (
  SELECT
    t.id, t.type, t.amount, t.doctor_id, t.reference_type, t.reference_id,
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
  doc.full_name_ar AS doctor_name,
  nr.reference_type,
  nr.reference_id,
  nr.transaction_date,
  dup.id AS existing_row_id,
  dup.amount AS existing_row_amount,
  dup.clinic_id AS existing_row_clinic_id
FROM null_rows nr
LEFT JOIN public.doctors doc ON doc.id = nr.doctor_id
JOIN public.transactions dup
  ON dup.clinic_id = nr.derived_clinic_id
  AND dup.reference_type = nr.reference_type
  AND dup.reference_id = nr.reference_id
  AND dup.id <> nr.id
ORDER BY nr.transaction_date;
