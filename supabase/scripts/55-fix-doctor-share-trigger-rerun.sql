-- =============================================================================
-- إصلاح نسبة الطبيب في الدفعات الجديدة — Master Clinic Plus
-- شغّله في Supabase → SQL Editor
--
-- المشكلة: منذ ~6 تموز trigger calculate_operation_shares يحسب حصة الطبيب خطأ
--   • دفعة علاج + is_review_statement بدون كشفية → حصة طبيب = 0
--   • جلسة بدون حالة/سعر كلي → حصة طبيب = 0
--   • نسبة الحالة القديمة (50/50) تُستخدم بدل نسبة الطبيب الحالية
--
-- ⚠️ شغّل «معاينة» أولاً ثم «تطبيق»
-- =============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- 1) تحديث trigger — الدفعات الجديدة تصح من الآن
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.calculate_operation_shares()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agreed         NUMERIC;
  v_total_paid     NUMERIC;
  v_locked         BOOLEAN;
  v_doc_pct        NUMERIC := 0.5;
  v_mat_share      NUMERIC := 0;
  v_payment_type   TEXT := 'percentage';
  v_doc_gross      NUMERIC;
  v_doc_share      NUMERIC;
  v_clinic_share   NUMERIC;
  v_is_plan        BOOLEAN;
  v_review_fee     NUMERIC;
  v_plan_total     NUMERIC;
  v_case_id        UUID;
  v_case_doc       NUMERIC;
  v_case_clinic    NUMERIC;
  v_case_paid      NUMERIC;
  v_new_paid       NUMERIC;
  v_case_final     NUMERIC;
  v_patient_doc    NUMERIC;
  v_patient_clinic NUMERIC;
  v_paid           NUMERIC;
  v_treatment_paid NUMERIC;
BEGIN
  SELECT agreed_total, total_paid, financial_locked
  INTO v_agreed, v_total_paid, v_locked
  FROM public.patients
  WHERE id = NEW.patient_id;

  v_agreed := COALESCE(v_agreed, 0);
  v_total_paid := COALESCE(v_total_paid, 0);
  v_review_fee := COALESCE(NEW.review_fee_amount, 0);

  IF NEW.session_kind = 'refund' THEN
    NEW.total_amount := 0;
    NEW.materials_cost := COALESCE(NEW.materials_cost, 0);
    NEW.doctor_share_amount := COALESCE(NEW.doctor_share_amount, 0);
    NEW.clinic_share_amount := COALESCE(NEW.clinic_share_amount, 0);

    IF NEW.treatment_case_id IS NOT NULL THEN
      v_case_id := NEW.treatment_case_id;
      SELECT doctor_share_total, clinic_share_total, total_paid
      INTO v_case_doc, v_case_clinic, v_case_paid
      FROM public.patient_treatment_cases
      WHERE id = v_case_id;

      IF FOUND THEN
        v_new_paid := GREATEST(0, ROUND(v_case_paid + COALESCE(NEW.paid_amount, 0), 2));
        UPDATE public.patient_treatment_cases
        SET
          doctor_share_total = GREATEST(0, ROUND(v_case_doc - ABS(COALESCE(NEW.doctor_share_amount, 0)), 2)),
          clinic_share_total = GREATEST(0, ROUND(v_case_clinic - ABS(COALESCE(NEW.clinic_share_amount, 0)), 2)),
          total_paid = v_new_paid,
          status = CASE
            WHEN v_new_paid >= final_price AND final_price > 0 THEN 'completed'
            ELSE 'active'
          END,
          updated_at = now()
        WHERE id = v_case_id;
      END IF;
    ELSIF v_agreed > 0 THEN
      v_new_paid := GREATEST(0, ROUND(v_total_paid + COALESCE(NEW.paid_amount, 0), 2));
      UPDATE public.patients
      SET
        total_paid = v_new_paid,
        doctor_share_total = GREATEST(
          0,
          ROUND(COALESCE(doctor_share_total, 0) - ABS(COALESCE(NEW.doctor_share_amount, 0)), 2)
        ),
        clinic_share_total = GREATEST(
          0,
          ROUND(COALESCE(clinic_share_total, 0) - ABS(COALESCE(NEW.clinic_share_amount, 0)), 2)
        )
      WHERE id = NEW.patient_id;

      v_total_paid := v_new_paid;
      NEW.remaining_debt := GREATEST(0, v_agreed - v_total_paid);

      IF v_total_paid < v_agreed THEN
        UPDATE public.patients SET treatment_status = 'active' WHERE id = NEW.patient_id;
      END IF;
    ELSE
      NEW.remaining_debt := GREATEST(0, COALESCE(NEW.total_amount, 0) - COALESCE(NEW.paid_amount, 0));
    END IF;

    RETURN NEW;
  END IF;

  v_is_plan := (
    NEW.session_kind = 'plan'
    OR (COALESCE(NEW.total_amount, 0) > 0 AND NOT COALESCE(v_locked, FALSE))
  );

  IF v_is_plan AND (COALESCE(NEW.total_amount, 0) > 0 OR v_review_fee > 0) THEN
    v_plan_total := COALESCE(NEW.total_amount, 0) + v_review_fee;

    SELECT
      COALESCE(NULLIF(d.payment_type, ''), 'percentage'),
      (d.percentage::TEXT)::NUMERIC / 100,
      (d.materials_share::TEXT)::NUMERIC / 100
    INTO v_payment_type, v_doc_pct, v_mat_share
    FROM public.doctors d
    WHERE d.id = NEW.doctor_id;

    IF COALESCE(v_payment_type, 'percentage') = 'salary' THEN
      v_doc_share := 0;
      v_clinic_share := v_plan_total;
    ELSE
      v_doc_gross := COALESCE(NEW.total_amount, 0) * v_doc_pct;
      v_doc_share := v_doc_gross - (COALESCE(NEW.materials_cost, 0) * v_mat_share);
      v_clinic_share := (COALESCE(NEW.total_amount, 0) - v_doc_share) + v_review_fee;
    END IF;

    UPDATE public.patients
    SET
      agreed_total = v_plan_total,
      doctor_share_total = ROUND(v_doc_share::NUMERIC, 2),
      clinic_share_total = ROUND(v_clinic_share::NUMERIC, 2),
      previous_total = v_plan_total,
      financial_locked = TRUE,
      total_paid = total_paid + COALESCE(NEW.paid_amount, 0)
    WHERE id = NEW.patient_id;

    SELECT total_paid INTO v_total_paid FROM public.patients WHERE id = NEW.patient_id;

    NEW.session_kind := 'plan';
    IF COALESCE(v_payment_type, 'percentage') = 'salary' THEN
      NEW.doctor_share_amount := 0;
      NEW.clinic_share_amount := CASE
        WHEN COALESCE(NEW.paid_amount, 0) > 0 THEN ROUND(COALESCE(NEW.paid_amount, 0), 2)
        ELSE 0
      END;
    ELSIF COALESCE(NEW.paid_amount, 0) > 0 AND v_plan_total > 0 THEN
      NEW.doctor_share_amount := ROUND(NEW.paid_amount * v_doc_share / v_plan_total, 2);
      NEW.clinic_share_amount := ROUND(NEW.paid_amount * v_clinic_share / v_plan_total, 2);
    ELSE
      NEW.doctor_share_amount := 0;
      NEW.clinic_share_amount := 0;
    END IF;
    NEW.remaining_debt := GREATEST(0, v_plan_total - v_total_paid);

    RETURN NEW;
  END IF;

  NEW.session_kind := 'payment';
  NEW.total_amount := 0;
  NEW.materials_cost := COALESCE(NEW.materials_cost, 0);
  v_paid := COALESCE(NEW.paid_amount, 0);

  SELECT
    COALESCE(NULLIF(d.payment_type, ''), 'percentage'),
    (d.percentage::TEXT)::NUMERIC / 100,
    (d.materials_share::TEXT)::NUMERIC / 100
  INTO v_payment_type, v_doc_pct, v_mat_share
  FROM public.doctors d
  WHERE d.id = NEW.doctor_id;

  IF COALESCE(v_payment_type, 'percentage') = 'salary' THEN
    NEW.doctor_share_amount := 0;
    NEW.clinic_share_amount := ROUND(v_paid, 2);
  ELSIF v_paid > 0 AND (
    (v_review_fee > 0 AND v_paid <= v_review_fee + 0.01)
    OR (
      COALESCE(NEW.is_review_statement, FALSE)
      AND v_review_fee <= 0
      AND NEW.treatment_case_id IS NULL
      AND COALESCE(v_agreed, 0) <= 0
    )
  ) THEN
    -- كشفية فقط — 100% للعيادة (مو دفعة علاج)
    NEW.doctor_share_amount := 0;
    NEW.clinic_share_amount := ROUND(v_paid, 2);
  ELSIF NEW.treatment_case_id IS NOT NULL AND v_paid > 0 THEN
    IF v_review_fee > 0 AND v_paid > v_review_fee THEN
      v_treatment_paid := v_paid - v_review_fee;
    ELSE
      v_treatment_paid := v_paid;
    END IF;

    SELECT doctor_share_total, clinic_share_total, final_price
    INTO v_case_doc, v_case_clinic, v_case_final
    FROM public.patient_treatment_cases
    WHERE id = NEW.treatment_case_id;

    IF COALESCE(v_case_final, 0) > 0
       AND COALESCE(v_case_doc, 0) > 0
       AND ABS((v_case_doc / v_case_final) - COALESCE(v_doc_pct, 0.5)) > 0.011
    THEN
      NEW.doctor_share_amount := ROUND(
        GREATEST(0, v_treatment_paid * COALESCE(v_doc_pct, 0.5)
          - NEW.materials_cost * v_mat_share),
        2
      );
    ELSIF COALESCE(v_case_final, 0) > 0 AND COALESCE(v_case_doc, 0) > 0 THEN
      NEW.doctor_share_amount := ROUND(
        GREATEST(0, v_treatment_paid * COALESCE(v_case_doc, 0) / v_case_final
          - NEW.materials_cost * v_mat_share),
        2
      );
    ELSE
      NEW.doctor_share_amount := ROUND(
        GREATEST(0, v_treatment_paid * COALESCE(v_doc_pct, 0.5)
          - NEW.materials_cost * v_mat_share),
        2
      );
    END IF;
    NEW.clinic_share_amount := ROUND(v_paid - NEW.doctor_share_amount, 2);
  ELSIF v_agreed > 0 AND v_paid > 0 THEN
    IF v_review_fee > 0 AND v_paid > v_review_fee THEN
      v_treatment_paid := v_paid - v_review_fee;
    ELSE
      v_treatment_paid := v_paid;
    END IF;

    SELECT doctor_share_total, clinic_share_total
    INTO v_patient_doc, v_patient_clinic
    FROM public.patients
    WHERE id = NEW.patient_id;

    IF COALESCE(v_agreed, 0) > 0
       AND COALESCE(v_patient_doc, 0) > 0
       AND ABS((v_patient_doc / v_agreed) - COALESCE(v_doc_pct, 0.5)) > 0.011
    THEN
      NEW.doctor_share_amount := ROUND(
        GREATEST(0, v_treatment_paid * COALESCE(v_doc_pct, 0.5)
          - NEW.materials_cost * v_mat_share),
        2
      );
    ELSE
      NEW.doctor_share_amount := ROUND(
        GREATEST(0, v_treatment_paid * COALESCE(v_patient_doc, 0) / v_agreed
          - NEW.materials_cost * v_mat_share),
        2
      );
    END IF;
    NEW.clinic_share_amount := ROUND(v_paid - NEW.doctor_share_amount, 2);
  ELSIF v_paid > 0 THEN
    -- جلسة مراجع بدون سعر كلي — نسبة الطبيب مباشرة
    IF v_review_fee > 0 AND v_paid > v_review_fee THEN
      v_treatment_paid := v_paid - v_review_fee;
    ELSE
      v_treatment_paid := v_paid;
    END IF;
    NEW.doctor_share_amount := ROUND(
      GREATEST(0, v_treatment_paid * COALESCE(v_doc_pct, 0.5)
        - NEW.materials_cost * v_mat_share),
      2
    );
    NEW.clinic_share_amount := ROUND(v_paid - NEW.doctor_share_amount, 2);
  ELSE
    NEW.doctor_share_amount := 0;
    NEW.clinic_share_amount := 0;
  END IF;

  IF v_agreed > 0 THEN
    UPDATE public.patients
    SET total_paid = total_paid + COALESCE(NEW.paid_amount, 0)
    WHERE id = NEW.patient_id;

    SELECT total_paid INTO v_total_paid FROM public.patients WHERE id = NEW.patient_id;
    NEW.remaining_debt := GREATEST(0, v_agreed - v_total_paid);
  ELSE
    NEW.remaining_debt := GREATEST(0, COALESCE(NEW.total_amount, 0) - COALESCE(NEW.paid_amount, 0));
  END IF;

  RETURN NEW;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2) معاينة — دفعات آخر 14 يوم بحصة خاطئة
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  d.full_name_ar AS doctor_name,
  po.operation_date,
  pat.full_name_ar AS patient_name,
  po.paid_amount,
  po.review_fee_amount,
  po.is_review_statement,
  po.doctor_share_amount AS share_now,
  ROUND(sub.expected_doc_share::numeric, 2) AS share_should_be,
  ROUND((po.doctor_share_amount - sub.expected_doc_share)::numeric, 2) AS diff,
  sub.issue_hint,
  po.id AS operation_id
FROM public.patient_operations po
JOIN public.doctors d ON d.id = po.doctor_id
JOIN public.patients pat ON pat.id = po.patient_id
JOIN LATERAL (
  SELECT
    GREATEST(
      0,
      (
        COALESCE(po.paid_amount, 0)
        - CASE
            WHEN COALESCE(po.review_fee_amount, 0) > 0
                 AND COALESCE(po.paid_amount, 0) > COALESCE(po.review_fee_amount, 0)
              THEN COALESCE(po.review_fee_amount, 0)
            ELSE 0
          END
      ) * (COALESCE((d.percentage::TEXT)::NUMERIC, 50) / 100)
      - COALESCE(po.materials_cost, 0)
        * (COALESCE((d.materials_share::TEXT)::NUMERIC, 0) / 100)
    ) AS expected_doc_share,
    CASE
      WHEN COALESCE(po.is_review_statement, false)
        AND COALESCE(po.review_fee_amount, 0) <= 0
        AND po.treatment_case_id IS NOT NULL
        AND COALESCE(po.doctor_share_amount, 0) <= 0.01
        THEN 'علم كشفية قديم — دفعة علاج'
      WHEN COALESCE(po.doctor_share_amount, 0) <= 0.01
        AND COALESCE(po.paid_amount, 0) > 0
        THEN 'حصة طبيب = 0'
      ELSE 'نسبة لا تطابق ملف الطبيب'
    END AS issue_hint
) sub ON true
WHERE po.operation_date >= CURRENT_DATE - 14
  AND COALESCE(po.paid_amount, 0) > 0
  AND COALESCE(NULLIF(d.payment_type, ''), 'percentage') <> 'salary'
  AND COALESCE(po.session_kind, '') NOT IN ('refund', 'discount')
  AND ABS(COALESCE(po.doctor_share_amount, 0) - sub.expected_doc_share) > 1.01
  AND NOT (
    COALESCE(po.review_fee_amount, 0) > 0
    AND COALESCE(po.paid_amount, 0) <= COALESCE(po.review_fee_amount, 0) + 0.01
  )
ORDER BY po.operation_date DESC, ABS(po.doctor_share_amount - sub.expected_doc_share) DESC;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2ب) تحقق حاسم — ملف كل طبيب متأثّر + تفصيل نسبة الحالة
--     ⚠️ إذا share_should_be = 0 لطبيب نسبة، معناه percentage ناقصة/صفر في ملفه
--        (مثل غيث) — لا تطبّق حتى تصلّح نسبته أولاً من إعدادات الطبيب.
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  d.full_name_ar AS doctor_name,
  d.id AS doctor_id,
  d.payment_type,
  d.percentage AS doctor_pct,
  d.materials_share,
  CASE
    WHEN COALESCE(NULLIF(d.payment_type, ''), 'percentage') = 'salary'
      THEN '— طبيب راتب (حصته يجب = 0)'
    WHEN COALESCE((d.percentage::TEXT)::NUMERIC, 0) <= 0
      THEN '⛔ نسبة الطبيب = 0 أو غير مضبوطة — صحّحها قبل الإصلاح'
    ELSE '✅ نسبة مضبوطة'
  END AS pct_status
FROM public.doctors d
WHERE d.id IN (
  SELECT DISTINCT po.doctor_id
  FROM public.patient_operations po
  WHERE po.operation_date >= CURRENT_DATE - 14
    AND COALESCE(po.paid_amount, 0) > 0
)
ORDER BY d.full_name_ar;

-- تفصيل كل جلسة متأثّرة: نسبة الحالة المخزّنة مقابل نسبة الطبيب
SELECT
  d.full_name_ar AS doctor_name,
  po.id AS operation_id,
  po.operation_date,
  pat.full_name_ar AS patient_name,
  po.paid_amount,
  po.review_fee_amount,
  po.is_review_statement,
  po.materials_cost,
  po.doctor_share_amount AS share_now,
  ROUND((po.doctor_share_amount / NULLIF(po.paid_amount, 0) * 100)::numeric, 2) AS share_now_pct,
  d.percentage AS doctor_pct,
  ptc.final_price AS case_final_price,
  ptc.doctor_share_total AS case_doc_total,
  ROUND((ptc.doctor_share_total / NULLIF(ptc.final_price, 0) * 100)::numeric, 2) AS case_ratio_pct,
  po.treatment_case_id
FROM public.patient_operations po
JOIN public.doctors d ON d.id = po.doctor_id
JOIN public.patients pat ON pat.id = po.patient_id
LEFT JOIN public.patient_treatment_cases ptc ON ptc.id = po.treatment_case_id
WHERE po.operation_date >= CURRENT_DATE - 14
  AND COALESCE(po.paid_amount, 0) > 0
  AND COALESCE(NULLIF(d.payment_type, ''), 'percentage') <> 'salary'
  AND COALESCE(po.session_kind, '') NOT IN ('refund', 'discount')
  AND ABS(
    COALESCE(po.doctor_share_amount, 0)
    - GREATEST(0,
        (COALESCE(po.paid_amount, 0)
          - CASE WHEN COALESCE(po.review_fee_amount, 0) > 0
                   AND COALESCE(po.paid_amount, 0) > COALESCE(po.review_fee_amount, 0)
                 THEN COALESCE(po.review_fee_amount, 0) ELSE 0 END)
        * (COALESCE((d.percentage::TEXT)::NUMERIC, 50) / 100)
        - COALESCE(po.materials_cost, 0) * (COALESCE((d.materials_share::TEXT)::NUMERIC, 0) / 100)
      )
  ) > 1.01
ORDER BY po.operation_date DESC, po.paid_amount DESC;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3) تطبيق — إعادة حساب دفعات آخر 14 يوم (شغّله بعد مراجعة المعاينة)
--     ⚠️ لا تطبّق إذا أي طبيب نسبته = 0 في القسم 2ب — صحّح النسبة أولاً
-- ═══════════════════════════════════════════════════════════════════════════
-- BEGIN;

-- ALTER TABLE public.patient_operations DISABLE TRIGGER USER;

-- UPDATE public.patient_operations po
-- SET
--   is_review_statement = CASE
--     WHEN sub.clear_review_flag THEN false
--     ELSE po.is_review_statement
--   END,
--   doctor_share_amount = sub.doc_share,
--   clinic_share_amount = sub.clinic_share
-- FROM (
--   SELECT
--     po2.id,
--     ROUND(
--       GREATEST(
--         0,
--         (
--           COALESCE(po2.paid_amount, 0)
--           - CASE
--               WHEN COALESCE(po2.review_fee_amount, 0) > 0
--                    AND COALESCE(po2.paid_amount, 0) > COALESCE(po2.review_fee_amount, 0)
--                 THEN COALESCE(po2.review_fee_amount, 0)
--               ELSE 0
--             END
--         ) * (COALESCE((d.percentage::TEXT)::NUMERIC, 50) / 100)
--         - COALESCE(po2.materials_cost, 0)
--           * (COALESCE((d.materials_share::TEXT)::NUMERIC, 0) / 100)
--       ),
--       2
--     ) AS doc_share,
--     ROUND(
--       COALESCE(po2.paid_amount, 0)
--       - GREATEST(
--         0,
--         (
--           COALESCE(po2.paid_amount, 0)
--           - CASE
--               WHEN COALESCE(po2.review_fee_amount, 0) > 0
--                    AND COALESCE(po2.paid_amount, 0) > COALESCE(po2.review_fee_amount, 0)
--                 THEN COALESCE(po2.review_fee_amount, 0)
--               ELSE 0
--             END
--         ) * (COALESCE((d.percentage::TEXT)::NUMERIC, 50) / 100)
--         - COALESCE(po2.materials_cost, 0)
--           * (COALESCE((d.materials_share::TEXT)::NUMERIC, 0) / 100)
--       ),
--       2
--     ) AS clinic_share,
--     (
--       COALESCE(po2.is_review_statement, false)
--       AND COALESCE(po2.review_fee_amount, 0) <= 0
--       AND NOT c.review_fee_enabled
--       AND po2.treatment_case_id IS NOT NULL
--     ) AS clear_review_flag
--   FROM public.patient_operations po2
--   JOIN public.doctors d ON d.id = po2.doctor_id
--   JOIN public.clinics c ON c.id = po2.clinic_id
--   WHERE po2.operation_date >= CURRENT_DATE - 14
--     AND COALESCE(po2.paid_amount, 0) > 0
--     AND COALESCE(NULLIF(d.payment_type, ''), 'percentage') <> 'salary'
--     AND COALESCE(po2.session_kind, '') NOT IN ('refund', 'discount')
--     AND NOT (
--       COALESCE(po2.review_fee_amount, 0) > 0
--       AND COALESCE(po2.paid_amount, 0) <= COALESCE(po2.review_fee_amount, 0) + 0.01
--     )
-- ) sub
-- WHERE po.id = sub.id;

-- ALTER TABLE public.patient_operations ENABLE TRIGGER USER;

-- COMMIT;

NOTIFY pgrst, 'reload schema';
