-- =============================================================================
-- إصلاح كشفيات دخلت محفظة الطبيب — سجاد / حارث
-- شغّله في Supabase → SQL Editor
--
-- بناءً على نتائج 53-diagnose-doctor-balance.sql:
--   • حارث — الرصيد صحيح (16,000) لكن فيه جلسة كشفية مشبوهة
--   • سجاد — زيادة 10,000 بسبب كشفية + مضاعفة محتملة
--
-- ⚠️ شغّل «معاينة» أولاً — لا تشغّل «تطبيق» إلا بعد التأكد
--
-- ⛔ إذا balance_after_fix سالب (مثل حارث -4,000) — لا تطبّق أبداً!
--    الرصيد الحالي صحيح والعلم «كشفية» إنذار خاطئ على جلسة قديمة.
--    سكربت 54 للكشفيات القديمة فقط — مو لإصلاح نسب الدفعات الجديدة.
--    للدفعات الجديدة استخدم: 55-fix-doctor-share-trigger-rerun.sql
-- =============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- الإعدادات
-- ═══════════════════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS _fix_doc_config;
CREATE TEMP TABLE _fix_doc_config AS
SELECT unnest(ARRAY['سجاد', 'حارث'])::text AS doctor_name_like;


DROP TABLE IF EXISTS _fix_doc_target;
CREATE TEMP TABLE _fix_doc_target AS
SELECT DISTINCT ON (d.id)
  d.id,
  d.full_name_ar,
  d.percentage,
  d.materials_share,
  d.payment_type
FROM public.doctors d
JOIN _fix_doc_config cfg ON d.full_name_ar ILIKE '%' || cfg.doctor_name_like || '%'
ORDER BY d.id;


-- ═══════════════════════════════════════════════════════════════════════════
-- أ) الجلسات المشبوهة — شغّل هذا أولاً
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  d.full_name_ar AS doctor_name,
  po.id AS operation_id,
  po.operation_date,
  pat.full_name_ar AS patient_name,
  po.operation_name_ar,
  po.paid_amount,
  po.review_fee_amount,
  po.is_review_statement,
  po.doctor_share_amount,
  po.clinic_share_amount,
  ROUND(public.calc_doctor_operation_earned(
    po.doctor_id, po.doctor_share_amount, po.paid_amount, po.treatment_case_id
  )::numeric, 2) AS earned_now,
  CASE
    WHEN COALESCE(po.review_fee_amount, 0) > 0
      AND COALESCE(po.paid_amount, 0) > COALESCE(po.review_fee_amount, 0)
      AND COALESCE(po.is_review_statement, false) = true
      AND (po.paid_amount / NULLIF(po.review_fee_amount, 0)) BETWEEN 6.5 AND 7.5
      THEN 'مضاعفة كشفية (35k→30k)'
    WHEN COALESCE(po.review_fee_amount, 0) > 0
      AND (
        COALESCE(po.is_review_statement, false) = true
        OR COALESCE(po.paid_amount, 0) <= COALESCE(po.review_fee_amount, 0) + 0.01
      )
      AND COALESCE(po.doctor_share_amount, 0) > 0.01
      THEN 'كشفية فقط — حصة طبيب يجب = 0'
    ELSE 'أخرى'
  END AS issue_type
FROM public.patient_operations po
JOIN _fix_doc_target d ON d.id = po.doctor_id
JOIN public.patients pat ON pat.id = po.patient_id
WHERE COALESCE(po.paid_amount, 0) > 0
  AND (
    -- كشفية فقط لكن للطبيب حصة
    (
      COALESCE(po.review_fee_amount, 0) > 0
      AND (
        COALESCE(po.is_review_statement, false) = true
        OR COALESCE(po.paid_amount, 0) <= COALESCE(po.review_fee_amount, 0) + 0.01
      )
      AND COALESCE(po.doctor_share_amount, 0) > 0.01
    )
    OR
    -- مضاعفة كشفية (ratio ≈ 7)
    (
      COALESCE(po.review_fee_amount, 0) > 0
      AND COALESCE(po.paid_amount, 0) > COALESCE(po.review_fee_amount, 0)
      AND COALESCE(po.is_review_statement, false) = true
      AND (po.paid_amount / NULLIF(po.review_fee_amount, 0)) BETWEEN 6.5 AND 7.5
    )
  )
ORDER BY d.full_name_ar, po.operation_date;


-- ═══════════════════════════════════════════════════════════════════════════
-- ب) معاينة التصحيح — كم ينقص الرصيد بعد الإصلاح؟
-- ═══════════════════════════════════════════════════════════════════════════
WITH bad_ops AS (
  SELECT
    po.id,
    po.doctor_id,
    po.paid_amount,
    po.review_fee_amount,
    po.doctor_share_amount,
    po.clinic_share_amount,
    po.materials_cost,
    po.is_review_statement,
    d.percentage,
    d.materials_share,
    public.calc_doctor_operation_earned(
      po.doctor_id, po.doctor_share_amount, po.paid_amount, po.treatment_case_id
    ) AS earned_before,
    CASE
      -- مضاعفة: 35k → 30k
      WHEN COALESCE(po.review_fee_amount, 0) > 0
        AND COALESCE(po.paid_amount, 0) > COALESCE(po.review_fee_amount, 0)
        AND COALESCE(po.is_review_statement, false) = true
        AND (po.paid_amount / NULLIF(po.review_fee_amount, 0)) BETWEEN 6.5 AND 7.5
        THEN ROUND(
          GREATEST(
            0,
            COALESCE(po.paid_amount, 0)
            - COALESCE(po.review_fee_amount, 0) * 2
            - COALESCE(po.materials_cost, 0)
              * (COALESCE((d.materials_share::TEXT)::NUMERIC, 0) / 100)
          ) * (COALESCE((d.percentage::TEXT)::NUMERIC, 50) / 100),
          2
        )
      -- كشفية فقط: حصة طبيب = 0
      WHEN COALESCE(po.review_fee_amount, 0) > 0
        AND (
          COALESCE(po.is_review_statement, false) = true
          OR COALESCE(po.paid_amount, 0) <= COALESCE(po.review_fee_amount, 0) + 0.01
        )
        AND COALESCE(po.doctor_share_amount, 0) > 0.01
        THEN 0
      ELSE public.calc_doctor_operation_earned(
        po.doctor_id, po.doctor_share_amount, po.paid_amount, po.treatment_case_id
      )
    END AS earned_after
  FROM public.patient_operations po
  JOIN _fix_doc_target d ON d.id = po.doctor_id
  WHERE COALESCE(po.paid_amount, 0) > 0
    AND (
      (
        COALESCE(po.review_fee_amount, 0) > 0
        AND (
          COALESCE(po.is_review_statement, false) = true
          OR COALESCE(po.paid_amount, 0) <= COALESCE(po.review_fee_amount, 0) + 0.01
        )
        AND COALESCE(po.doctor_share_amount, 0) > 0.01
      )
      OR (
        COALESCE(po.review_fee_amount, 0) > 0
        AND COALESCE(po.paid_amount, 0) > COALESCE(po.review_fee_amount, 0)
        AND COALESCE(po.is_review_statement, false) = true
        AND (po.paid_amount / NULLIF(po.review_fee_amount, 0)) BETWEEN 6.5 AND 7.5
      )
    )
),
per_doctor AS (
  SELECT
    dt.full_name_ar,
    dt.id AS doctor_id,
    COALESCE(SUM(b.earned_before - b.earned_after), 0) AS total_reduction
  FROM _fix_doc_target dt
  LEFT JOIN bad_ops b ON b.doctor_id = dt.id
  GROUP BY dt.full_name_ar, dt.id
)
SELECT
  pd.full_name_ar AS doctor_name,
  (public.get_doctor_wallet_stats(pd.doctor_id) ->> 'available_balance')::numeric AS balance_before,
  ROUND(pd.total_reduction::numeric, 2) AS reduction_from_fix,
  ROUND((
    (public.get_doctor_wallet_stats(pd.doctor_id) ->> 'available_balance')::numeric
    - pd.total_reduction
  )::numeric, 2) AS balance_after_fix
FROM per_doctor pd
ORDER BY pd.full_name_ar;

-- ⛔ إذا ظهر balance_after_fix < 0 لأي طبيب — لا تشغّل القسم (ج)
SELECT
  full_name_ar AS doctor_name,
  balance_before,
  reduction_from_fix,
  balance_after_fix,
  CASE
    WHEN balance_after_fix < 0 THEN '⛔ لا تطبّق — الرصيد الحالي صحيح'
    WHEN reduction_from_fix <= 0 THEN '— لا حاجة للتطبيق'
    ELSE '✅ راجع القسم (أ) ثم فكّر بالتطبيق'
  END AS apply_decision
FROM (
  SELECT
    dt.full_name_ar,
    (public.get_doctor_wallet_stats(dt.id) ->> 'available_balance')::numeric AS balance_before,
    COALESCE(SUM(b.earned_before - b.earned_after), 0) AS reduction_from_fix,
    (public.get_doctor_wallet_stats(dt.id) ->> 'available_balance')::numeric
      - COALESCE(SUM(b.earned_before - b.earned_after), 0) AS balance_after_fix
  FROM _fix_doc_target dt
  LEFT JOIN (
    SELECT doctor_id,
      public.calc_doctor_operation_earned(
        po.doctor_id, po.doctor_share_amount, po.paid_amount, po.treatment_case_id
      ) AS earned_before,
      CASE
        WHEN COALESCE(po.review_fee_amount, 0) > 0
          AND COALESCE(po.paid_amount, 0) > COALESCE(po.review_fee_amount, 0)
          AND COALESCE(po.is_review_statement, false) = true
          AND (po.paid_amount / NULLIF(po.review_fee_amount, 0)) BETWEEN 6.5 AND 7.5
          THEN ROUND(GREATEST(0,
            COALESCE(po.paid_amount, 0) - COALESCE(po.review_fee_amount, 0) * 2
            - COALESCE(po.materials_cost, 0) * (COALESCE((d.materials_share::TEXT)::NUMERIC, 0) / 100)
          ) * (COALESCE((d.percentage::TEXT)::NUMERIC, 50) / 100), 2)
        WHEN COALESCE(po.review_fee_amount, 0) > 0
          AND (COALESCE(po.is_review_statement, false) = true
            OR COALESCE(po.paid_amount, 0) <= COALESCE(po.review_fee_amount, 0) + 0.01)
          AND COALESCE(po.doctor_share_amount, 0) > 0.01
          THEN 0
        ELSE public.calc_doctor_operation_earned(
          po.doctor_id, po.doctor_share_amount, po.paid_amount, po.treatment_case_id
        )
      END AS earned_after
    FROM public.patient_operations po
    JOIN public.doctors d ON d.id = po.doctor_id
    JOIN _fix_doc_target dt2 ON dt2.id = po.doctor_id
    WHERE COALESCE(po.paid_amount, 0) > 0
      AND (
        (COALESCE(po.review_fee_amount, 0) > 0 AND COALESCE(po.doctor_share_amount, 0) > 0.01
          AND (COALESCE(po.is_review_statement, false) = true
            OR COALESCE(po.paid_amount, 0) <= COALESCE(po.review_fee_amount, 0) + 0.01))
        OR (COALESCE(po.review_fee_amount, 0) > 0 AND COALESCE(po.is_review_statement, false) = true
          AND COALESCE(po.paid_amount, 0) > COALESCE(po.review_fee_amount, 0)
          AND (po.paid_amount / NULLIF(po.review_fee_amount, 0)) BETWEEN 6.5 AND 7.5)
      )
  ) b ON b.doctor_id = dt.id
  GROUP BY dt.id, dt.full_name_ar
) x;


-- ═══════════════════════════════════════════════════════════════════════════
-- ج) تطبيق الإصلاح — شغّله فقط بعد مراجعة (أ) و (ب)
-- ═══════════════════════════════════════════════════════════════════════════
-- BEGIN;

-- 1) كشفية فقط: حصة الطبيب = 0، كل المبلغ للعيادة
UPDATE public.patient_operations po
SET
  doctor_share_amount = 0,
  clinic_share_amount = ROUND(COALESCE(po.paid_amount, 0), 2)
FROM _fix_doc_target d
WHERE po.doctor_id = d.id
  AND COALESCE(po.paid_amount, 0) > 0
  AND COALESCE(po.review_fee_amount, 0) > 0
  AND (
    COALESCE(po.is_review_statement, false) = true
    OR COALESCE(po.paid_amount, 0) <= COALESCE(po.review_fee_amount, 0) + 0.01
  )
  AND COALESCE(po.doctor_share_amount, 0) > 0.01
  -- لا نلمس مضاعفة ratio≈7 هنا (تُعالج في الخطوة 2)
  AND NOT (
    COALESCE(po.paid_amount, 0) > COALESCE(po.review_fee_amount, 0)
    AND (po.paid_amount / NULLIF(po.review_fee_amount, 0)) BETWEEN 6.5 AND 7.5
  );

-- 2) مضاعفة كشفية: paid 35,000 → 30,000 وإعادة حساب الحصص
UPDATE public.patient_operations po
SET
  paid_amount = sub.new_paid,
  doctor_share_amount = sub.doc_share,
  clinic_share_amount = sub.clinic_share
FROM (
  SELECT
    po2.id,
    ROUND(COALESCE(po2.paid_amount, 0) - COALESCE(po2.review_fee_amount, 0), 2) AS new_paid,
    ROUND(
      GREATEST(
        0,
        COALESCE(po2.paid_amount, 0)
        - COALESCE(po2.review_fee_amount, 0) * 2
        - COALESCE(po2.materials_cost, 0)
          * (COALESCE((d.materials_share::TEXT)::NUMERIC, 0) / 100)
      ) * (COALESCE((d.percentage::TEXT)::NUMERIC, 50) / 100),
      2
    ) AS doc_share,
    ROUND(
      (COALESCE(po2.paid_amount, 0) - COALESCE(po2.review_fee_amount, 0))
      - ROUND(
        GREATEST(
          0,
          COALESCE(po2.paid_amount, 0)
          - COALESCE(po2.review_fee_amount, 0) * 2
          - COALESCE(po2.materials_cost, 0)
            * (COALESCE((d.materials_share::TEXT)::NUMERIC, 0) / 100)
        ) * (COALESCE((d.percentage::TEXT)::NUMERIC, 50) / 100),
        2
      ),
      2
    ) AS clinic_share
  FROM public.patient_operations po2
  JOIN _fix_doc_target d ON d.id = po2.doctor_id
  WHERE COALESCE(po2.review_fee_amount, 0) > 0
    AND COALESCE(po2.is_review_statement, false) = true
    AND COALESCE(po2.paid_amount, 0) > COALESCE(po2.review_fee_amount, 0)
    AND (po2.paid_amount / NULLIF(po2.review_fee_amount, 0)) BETWEEN 6.5 AND 7.5
) sub
WHERE po.id = sub.id;

-- COMMIT;

-- بعد التطبيق: أعد تشغيل القسم 8 من 53-diagnose-doctor-balance.sql للتحقق
