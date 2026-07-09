-- =============================================================================
-- معاينة شاملة — كل العيادات — أثر تصحيح حصص الطبيب/العيادة القديمة
-- شغّله بمحرر SQL بعد تطبيق سكربت 58 (توحيد الحساب) فقط — بدون أي تعديل بيانات
--
-- الفكرة: نحسب "الحصة الصحيحة" لكل دفعة (session_kind='payment') بنفس صيغة
-- trigger الجديد (نسبة الطبيب الحالية على مبلغ العلاج بعد خصم الكشفية
-- والمختبر) ونقارنها بالقيمة المخزّنة حالياً. القسم 4 فيه UPDATE مُعلَّق —
-- لا تفعّله إلا بعد مراجعة القسم 1 و2 و3 كاملة.
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 0) فحص أولي — أطباء بنسبة صفر/فارغة أو نوع دفع غريب (قد يكون خطأ إعداد،
--    لا تصحيح بيانات — راجعها يدوياً قبل أي شيء)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  c.name_ar AS clinic_name,
  d.full_name_ar AS doctor_name,
  d.payment_type,
  d.percentage,
  d.materials_share
FROM public.doctors d
JOIN public.clinics c ON c.id = d.clinic_id
WHERE d.is_active = TRUE
  AND (
    COALESCE(NULLIF(d.payment_type, ''), 'percentage') <> 'salary'
    AND (d.percentage IS NULL OR (d.percentage::TEXT)::NUMERIC NOT BETWEEN 1 AND 100)
  )
ORDER BY c.name_ar, d.full_name_ar;


-- ═══════════════════════════════════════════════════════════════════════════
-- 1) كل الدفعات (session_kind='payment') اللي حصتها المخزّنة تختلف عن
--    الحصة الصحيحة بأكثر من 1 — مرتبة حسب حجم الفرق
-- ═══════════════════════════════════════════════════════════════════════════
WITH corrected AS (
  SELECT
    po.id,
    c.name_ar AS clinic_name,
    d.full_name_ar AS doctor_name,
    pat.full_name_ar AS patient_name,
    po.operation_date,
    po.paid_amount,
    po.review_fee_amount,
    po.is_review_statement,
    po.materials_cost,
    po.doctor_share_amount AS doc_share_now,
    po.clinic_share_amount AS clinic_share_now,
    COALESCE(NULLIF(d.payment_type, ''), 'percentage') AS payment_type,
    (d.percentage::TEXT)::NUMERIC AS doctor_pct,
    CASE
      WHEN COALESCE(NULLIF(d.payment_type, ''), 'percentage') = 'salary' THEN 0
      WHEN po.paid_amount > 0 AND (
        (COALESCE(po.review_fee_amount, 0) > 0 AND po.paid_amount <= COALESCE(po.review_fee_amount, 0) + 0.01)
        OR (
          COALESCE(po.is_review_statement, FALSE)
          AND COALESCE(po.review_fee_amount, 0) <= 0
          AND po.treatment_case_id IS NULL
          AND COALESCE(pat.agreed_total, 0) <= 0
        )
      ) THEN 0
      WHEN po.paid_amount > 0 THEN
        ROUND(
          GREATEST(
            0,
            (
              po.paid_amount - CASE
                WHEN COALESCE(po.review_fee_amount, 0) > 0 AND po.paid_amount > COALESCE(po.review_fee_amount, 0)
                  THEN COALESCE(po.review_fee_amount, 0)
                ELSE 0
              END
            ) * COALESCE((d.percentage::TEXT)::NUMERIC, 50) / 100
            - COALESCE(po.materials_cost, 0) * COALESCE((d.materials_share::TEXT)::NUMERIC, 0) / 100
          ),
          2
        )
      ELSE 0
    END AS doc_share_correct
  FROM public.patient_operations po
  JOIN public.doctors d ON d.id = po.doctor_id
  JOIN public.clinics c ON c.id = po.clinic_id
  JOIN public.patients pat ON pat.id = po.patient_id
  WHERE po.session_kind = 'payment'
)
SELECT
  clinic_name,
  doctor_name,
  patient_name,
  operation_date,
  paid_amount,
  review_fee_amount,
  is_review_statement,
  materials_cost,
  doc_share_now,
  doc_share_correct,
  ROUND(doc_share_correct - COALESCE(doc_share_now, 0), 2) AS diff,
  ROUND(paid_amount - doc_share_correct, 2) AS clinic_share_correct,
  clinic_share_now,
  id AS operation_id
FROM corrected
WHERE ABS(doc_share_correct - COALESCE(doc_share_now, 0)) > 1
ORDER BY ABS(doc_share_correct - COALESCE(doc_share_now, 0)) DESC;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2) ملخص الأثر لكل طبيب — الفرق الكلي على رصيد المحفظة (كل العيادات)
-- ═══════════════════════════════════════════════════════════════════════════
WITH corrected AS (
  SELECT
    po.doctor_id,
    po.paid_amount,
    po.review_fee_amount,
    po.is_review_statement,
    po.materials_cost,
    po.doctor_share_amount AS doc_share_now,
    CASE
      WHEN COALESCE(NULLIF(d.payment_type, ''), 'percentage') = 'salary' THEN 0
      WHEN po.paid_amount > 0 AND (
        (COALESCE(po.review_fee_amount, 0) > 0 AND po.paid_amount <= COALESCE(po.review_fee_amount, 0) + 0.01)
        OR (
          COALESCE(po.is_review_statement, FALSE)
          AND COALESCE(po.review_fee_amount, 0) <= 0
          AND po.treatment_case_id IS NULL
          AND COALESCE(pat.agreed_total, 0) <= 0
        )
      ) THEN 0
      WHEN po.paid_amount > 0 THEN
        ROUND(
          GREATEST(
            0,
            (
              po.paid_amount - CASE
                WHEN COALESCE(po.review_fee_amount, 0) > 0 AND po.paid_amount > COALESCE(po.review_fee_amount, 0)
                  THEN COALESCE(po.review_fee_amount, 0)
                ELSE 0
              END
            ) * COALESCE((d.percentage::TEXT)::NUMERIC, 50) / 100
            - COALESCE(po.materials_cost, 0) * COALESCE((d.materials_share::TEXT)::NUMERIC, 0) / 100
          ),
          2
        )
      ELSE 0
    END AS doc_share_correct
  FROM public.patient_operations po
  JOIN public.doctors d ON d.id = po.doctor_id
  JOIN public.patients pat ON pat.id = po.patient_id
  WHERE po.session_kind = 'payment'
)
SELECT
  c.name_ar AS clinic_name,
  d.full_name_ar AS doctor_name,
  COUNT(*) FILTER (WHERE ABS(x.doc_share_correct - COALESCE(x.doc_share_now, 0)) > 1) AS affected_operations,
  ROUND(SUM(x.doc_share_correct - COALESCE(x.doc_share_now, 0)), 2) AS total_balance_diff,
  (public.get_doctor_wallet_stats(d.id) ->> 'available_balance')::numeric AS balance_now,
  ROUND(
    (public.get_doctor_wallet_stats(d.id) ->> 'available_balance')::numeric
    + SUM(x.doc_share_correct - COALESCE(x.doc_share_now, 0)),
    2
  ) AS balance_after_backfill
FROM corrected x
JOIN public.doctors d ON d.id = x.doctor_id
JOIN public.clinics c ON c.id = d.clinic_id
GROUP BY c.name_ar, d.id, d.full_name_ar
HAVING SUM(x.doc_share_correct - COALESCE(x.doc_share_now, 0)) <> 0
ORDER BY ABS(SUM(x.doc_share_correct - COALESCE(x.doc_share_now, 0))) DESC;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3) عياده الحلو فقط — حارث وسجاد بالتحديد (تحقق سريع)
-- ═══════════════════════════════════════════════════════════════════════════
WITH corrected AS (
  SELECT
    po.doctor_id,
    po.paid_amount,
    po.review_fee_amount,
    po.is_review_statement,
    po.materials_cost,
    po.doctor_share_amount AS doc_share_now,
    CASE
      WHEN COALESCE(NULLIF(d.payment_type, ''), 'percentage') = 'salary' THEN 0
      WHEN po.paid_amount > 0 AND (
        (COALESCE(po.review_fee_amount, 0) > 0 AND po.paid_amount <= COALESCE(po.review_fee_amount, 0) + 0.01)
        OR (
          COALESCE(po.is_review_statement, FALSE)
          AND COALESCE(po.review_fee_amount, 0) <= 0
          AND po.treatment_case_id IS NULL
          AND COALESCE(pat.agreed_total, 0) <= 0
        )
      ) THEN 0
      WHEN po.paid_amount > 0 THEN
        ROUND(
          GREATEST(
            0,
            (
              po.paid_amount - CASE
                WHEN COALESCE(po.review_fee_amount, 0) > 0 AND po.paid_amount > COALESCE(po.review_fee_amount, 0)
                  THEN COALESCE(po.review_fee_amount, 0)
                ELSE 0
              END
            ) * COALESCE((d.percentage::TEXT)::NUMERIC, 50) / 100
            - COALESCE(po.materials_cost, 0) * COALESCE((d.materials_share::TEXT)::NUMERIC, 0) / 100
          ),
          2
        )
      ELSE 0
    END AS doc_share_correct
  FROM public.patient_operations po
  JOIN public.doctors d ON d.id = po.doctor_id
  JOIN public.patients pat ON pat.id = po.patient_id
  WHERE po.session_kind = 'payment'
)
SELECT
  d.full_name_ar AS doctor_name,
  ROUND(SUM(x.doc_share_correct - COALESCE(x.doc_share_now, 0)), 2) AS total_balance_diff,
  (public.get_doctor_wallet_stats(d.id) ->> 'available_balance')::numeric AS balance_now,
  ROUND(
    (public.get_doctor_wallet_stats(d.id) ->> 'available_balance')::numeric
    + COALESCE(SUM(x.doc_share_correct - COALESCE(x.doc_share_now, 0)), 0),
    2
  ) AS balance_after_backfill
FROM public.doctors d
JOIN public.clinics c ON c.id = d.clinic_id
LEFT JOIN corrected x ON x.doctor_id = d.id
WHERE c.name_ar ILIKE '%الحلو%'
GROUP BY d.id, d.full_name_ar;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4) التطبيق — نفّذ فقط بعد مراجعة الأقسام 0-3 وموافقتك الصريحة
--    (احذف "--" من بداية كل سطر داخل BEGIN...COMMIT لتفعيله)
-- ═══════════════════════════════════════════════════════════════════════════
-- BEGIN;
--
-- UPDATE public.patient_operations po
-- SET
--   doctor_share_amount = sub.doc_share_correct,
--   clinic_share_amount = ROUND(po.paid_amount - sub.doc_share_correct, 2)
-- FROM (
--   SELECT
--     po2.id,
--     CASE
--       WHEN COALESCE(NULLIF(d.payment_type, ''), 'percentage') = 'salary' THEN 0
--       WHEN po2.paid_amount > 0 AND (
--         (COALESCE(po2.review_fee_amount, 0) > 0 AND po2.paid_amount <= COALESCE(po2.review_fee_amount, 0) + 0.01)
--         OR (
--           COALESCE(po2.is_review_statement, FALSE)
--           AND COALESCE(po2.review_fee_amount, 0) <= 0
--           AND po2.treatment_case_id IS NULL
--           AND COALESCE(pat.agreed_total, 0) <= 0
--         )
--       ) THEN 0
--       WHEN po2.paid_amount > 0 THEN
--         ROUND(
--           GREATEST(
--             0,
--             (
--               po2.paid_amount - CASE
--                 WHEN COALESCE(po2.review_fee_amount, 0) > 0 AND po2.paid_amount > COALESCE(po2.review_fee_amount, 0)
--                   THEN COALESCE(po2.review_fee_amount, 0)
--                 ELSE 0
--               END
--             ) * COALESCE((d.percentage::TEXT)::NUMERIC, 50) / 100
--             - COALESCE(po2.materials_cost, 0) * COALESCE((d.materials_share::TEXT)::NUMERIC, 0) / 100
--           ),
--           2
--         )
--       ELSE 0
--     END AS doc_share_correct
--   FROM public.patient_operations po2
--   JOIN public.doctors d ON d.id = po2.doctor_id
--   JOIN public.patients pat ON pat.id = po2.patient_id
--   WHERE po2.session_kind = 'payment'
-- ) sub
-- WHERE po.id = sub.id
--   AND ABS(sub.doc_share_correct - COALESCE(po.doctor_share_amount, 0)) > 1;
--
-- -- راجع النتيجة، وإذا كل شيء تمام:
-- COMMIT;
-- -- إذا في شيء غلط:
-- -- ROLLBACK;
