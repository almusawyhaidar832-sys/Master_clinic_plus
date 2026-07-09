-- =============================================================================
-- قائمة تفصيلية بكل صف مكرّر (سيُحذف) مع الصف الأصلي (سيبقى) — للمراجعة
-- الدقيقة قبل أي حذف. قراءة فقط.
-- =============================================================================
WITH null_rows AS (
  SELECT
    t.id, t.type, t.amount, t.doctor_id, t.clinic_id, t.reference_type,
    t.reference_id, t.transaction_date, t.description_ar, t.created_at,
    ROW_NUMBER() OVER (
      PARTITION BY t.reference_type, t.reference_id
      ORDER BY t.created_at, t.id
    ) AS rn
  FROM public.transactions t
  WHERE t.clinic_id IS NULL AND t.reference_id IS NOT NULL
)
SELECT
  nr.rn,
  nr.id,
  nr.type,
  nr.amount,
  nr.doctor_id,
  doc.full_name_ar AS doctor_name,
  nr.reference_type,
  nr.reference_id,
  nr.transaction_date,
  nr.description_ar,
  nr.created_at
FROM null_rows nr
LEFT JOIN public.doctors doc ON doc.id = nr.doctor_id
WHERE (nr.reference_type, nr.reference_id) IN (
  SELECT reference_type, reference_id FROM null_rows GROUP BY reference_type, reference_id HAVING COUNT(*) > 1
)
ORDER BY nr.reference_type, nr.reference_id, nr.rn;
