-- =============================================================================
-- الحل النهائي — تصحيح حصص الأطباء لعيادة الحلو فقط
-- شغّله في Supabase → SQL Editor
--
-- الخلفية:
--   • قبل 6 تموز الحساب كان دقيقاً: حصة الطبيب = المدفوع × نسبته − المختبر
--   • تعديلات 6 تموز (backfill) أعادت كتابة الحصص بنسب حالة قديمة مشوّهة
--     فصارت الأرصدة غلط (سجاد، حارث…)
--
-- هذا السكربت:
--   1) يصلّح trigger الحساب (للدفعات الجديدة — كل العيادات، آمن)
--   2) يعيد حساب حصص عيادة الحلو فقط بالنسبة الصحيحة (لا يمسّ العيادات التجريبية)
--   3) يتحقق من رصيد كل طبيب في الحلو
--
-- ⚠️ شغّل المقاطع بالترتيب. راجع «معاينة» (القسم 3) قبل «تطبيق» (القسم 4).
-- =============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- 0) تحديد عيادة الحلو + حماية
-- ═══════════════════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS _helu_clinic;
CREATE TEMP TABLE _helu_clinic AS
SELECT c.id, c.name_ar
FROM public.clinics c
WHERE c.name_ar ILIKE '%الحلو%' OR c.name ILIKE '%helu%' OR c.name ILIKE '%hulw%';

SELECT
  CASE
    WHEN NOT EXISTS (SELECT 1 FROM _helu_clinic) THEN
      '❌ لم تُعثر على عيادة الحلو — عدّل شرط الاسم في القسم 0'
    WHEN (SELECT COUNT(*) FROM _helu_clinic) > 1 THEN
      '⚠️ أكثر من عيادة مطابقة — راجع القائمة وحدّد id واحد'
    ELSE
      '✅ عيادة الحلو: ' || (SELECT name_ar || ' (' || id::text || ')' FROM _helu_clinic LIMIT 1)
  END AS clinic_status;

SELECT id, name_ar FROM _helu_clinic;


-- ═══════════════════════════════════════════════════════════════════════════
-- 1) تصحيح الـ trigger — الدفعات الجديدة تُحسب صح (كل العيادات — آمن)
--    حصة الطبيب = (المدفوع − الكشفية) × نسبته − حصته من المختبر
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
      GREATEST(0, LEAST(100, (d.materials_share::TEXT)::NUMERIC)) / 100
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

  -- ─── دفعة (payment) ───
  NEW.session_kind := 'payment';
  NEW.total_amount := 0;
  NEW.materials_cost := COALESCE(NEW.materials_cost, 0);
  v_paid := COALESCE(NEW.paid_amount, 0);

  SELECT
    COALESCE(NULLIF(d.payment_type, ''), 'percentage'),
    (d.percentage::TEXT)::NUMERIC / 100,
    GREATEST(0, LEAST(100, (d.materials_share::TEXT)::NUMERIC)) / 100
  INTO v_payment_type, v_doc_pct, v_mat_share
  FROM public.doctors d
  WHERE d.id = NEW.doctor_id;

  -- مبلغ العلاج = المدفوع − الكشفية (الكشفية للعيادة كاملة)
  IF v_review_fee > 0 AND v_paid > v_review_fee THEN
    v_treatment_paid := v_paid - v_review_fee;
  ELSE
    v_treatment_paid := v_paid;
  END IF;

  IF COALESCE(v_payment_type, 'percentage') = 'salary' THEN
    NEW.doctor_share_amount := 0;
    NEW.clinic_share_amount := ROUND(v_paid, 2);
  ELSIF v_paid > 0 AND v_review_fee > 0 AND v_paid <= v_review_fee + 0.01 THEN
    -- كشفية فقط — 100% للعيادة
    NEW.doctor_share_amount := 0;
    NEW.clinic_share_amount := ROUND(v_paid, 2);
  ELSIF v_paid > 0 THEN
    -- دفعة علاج: نسبة الطبيب على مبلغ العلاج − حصته من المختبر
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
-- 2) أطباء عيادة الحلو + نسبهم (تأكد النسب مضبوطة قبل الإصلاح)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  d.full_name_ar AS doctor_name,
  d.id AS doctor_id,
  d.payment_type,
  d.percentage AS doctor_pct,
  d.materials_share,
  CASE
    WHEN COALESCE(NULLIF(d.payment_type, ''), 'percentage') = 'salary' THEN '— طبيب راتب'
    WHEN COALESCE((d.percentage::TEXT)::NUMERIC, 0) <= 0 THEN '⛔ نسبة = 0 — صحّحها قبل الإصلاح'
    ELSE '✅ نسبة مضبوطة'
  END AS pct_status
FROM public.doctors d
JOIN _helu_clinic c ON c.id = d.clinic_id
ORDER BY d.full_name_ar;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3) معاينة — كل دفعة في الحلو: الحصة الحالية مقابل الصحيحة
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  d.full_name_ar AS doctor_name,
  po.operation_date,
  pat.full_name_ar AS patient_name,
  po.paid_amount,
  po.review_fee_amount,
  po.is_review_statement,
  po.materials_cost,
  po.doctor_share_amount AS share_now,
  sub.share_correct,
  ROUND((po.doctor_share_amount - sub.share_correct)::numeric, 2) AS diff,
  po.id AS operation_id
FROM public.patient_operations po
JOIN _helu_clinic c ON c.id = po.clinic_id
JOIN public.doctors d ON d.id = po.doctor_id
JOIN public.patients pat ON pat.id = po.patient_id
JOIN LATERAL (
  SELECT ROUND(
    CASE
      WHEN COALESCE(NULLIF(d.payment_type, ''), 'percentage') = 'salary' THEN 0
      WHEN COALESCE(po.review_fee_amount, 0) > 0
           AND COALESCE(po.paid_amount, 0) <= COALESCE(po.review_fee_amount, 0) + 0.01 THEN 0
      ELSE GREATEST(0,
        (COALESCE(po.paid_amount, 0)
          - CASE WHEN COALESCE(po.review_fee_amount, 0) > 0
                   AND COALESCE(po.paid_amount, 0) > COALESCE(po.review_fee_amount, 0)
                 THEN COALESCE(po.review_fee_amount, 0) ELSE 0 END)
        * (COALESCE((d.percentage::TEXT)::NUMERIC, 50) / 100)
        - COALESCE(po.materials_cost, 0)
          * (GREATEST(0, LEAST(100, (d.materials_share::TEXT)::NUMERIC)) / 100)
      )
    END, 2) AS share_correct
) sub ON TRUE
WHERE COALESCE(po.paid_amount, 0) > 0
  AND COALESCE(po.session_kind, '') NOT IN ('refund', 'discount')
  AND ABS(COALESCE(po.doctor_share_amount, 0) - sub.share_correct) > 1.01
ORDER BY d.full_name_ar, po.operation_date;

-- ملخص الفرق لكل طبيب (كم راح ينزل/يطلع الرصيد)
SELECT
  d.full_name_ar AS doctor_name,
  COUNT(*) AS affected_ops,
  ROUND(SUM(po.doctor_share_amount - sub.share_correct)::numeric, 2) AS total_diff,
  (public.get_doctor_wallet_stats(d.id) ->> 'available_balance')::numeric AS balance_now,
  ROUND((
    (public.get_doctor_wallet_stats(d.id) ->> 'available_balance')::numeric
    - SUM(po.doctor_share_amount - sub.share_correct)
  )::numeric, 2) AS balance_after
FROM public.patient_operations po
JOIN _helu_clinic c ON c.id = po.clinic_id
JOIN public.doctors d ON d.id = po.doctor_id
JOIN LATERAL (
  SELECT ROUND(
    CASE
      WHEN COALESCE(NULLIF(d.payment_type, ''), 'percentage') = 'salary' THEN 0
      WHEN COALESCE(po.review_fee_amount, 0) > 0
           AND COALESCE(po.paid_amount, 0) <= COALESCE(po.review_fee_amount, 0) + 0.01 THEN 0
      ELSE GREATEST(0,
        (COALESCE(po.paid_amount, 0)
          - CASE WHEN COALESCE(po.review_fee_amount, 0) > 0
                   AND COALESCE(po.paid_amount, 0) > COALESCE(po.review_fee_amount, 0)
                 THEN COALESCE(po.review_fee_amount, 0) ELSE 0 END)
        * (COALESCE((d.percentage::TEXT)::NUMERIC, 50) / 100)
        - COALESCE(po.materials_cost, 0)
          * (GREATEST(0, LEAST(100, (d.materials_share::TEXT)::NUMERIC)) / 100)
      )
    END, 2) AS share_correct
) sub ON TRUE
WHERE COALESCE(po.paid_amount, 0) > 0
  AND COALESCE(po.session_kind, '') NOT IN ('refund', 'discount')
  AND ABS(COALESCE(po.doctor_share_amount, 0) - sub.share_correct) > 1.01
GROUP BY d.id, d.full_name_ar
ORDER BY d.full_name_ar;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4) تطبيق — إعادة حساب حصص عيادة الحلو فقط
--    ⚠️ شغّله فقط بعد مراجعة القسم 3 والتأكد من balance_after
-- ═══════════════════════════════════════════════════════════════════════════
-- BEGIN;

-- ALTER TABLE public.patient_operations DISABLE TRIGGER USER;

-- UPDATE public.patient_operations po
-- SET
--   is_review_statement = CASE
--     WHEN COALESCE(po.review_fee_amount, 0) <= 0 THEN FALSE
--     ELSE po.is_review_statement
--   END,
--   doctor_share_amount = sub.share_correct,
--   clinic_share_amount = ROUND(COALESCE(po.paid_amount, 0) - sub.share_correct, 2)
-- FROM (
--   SELECT
--     po2.id,
--     ROUND(
--       CASE
--         WHEN COALESCE(NULLIF(d.payment_type, ''), 'percentage') = 'salary' THEN 0
--         WHEN COALESCE(po2.review_fee_amount, 0) > 0
--              AND COALESCE(po2.paid_amount, 0) <= COALESCE(po2.review_fee_amount, 0) + 0.01 THEN 0
--         ELSE GREATEST(0,
--           (COALESCE(po2.paid_amount, 0)
--             - CASE WHEN COALESCE(po2.review_fee_amount, 0) > 0
--                      AND COALESCE(po2.paid_amount, 0) > COALESCE(po2.review_fee_amount, 0)
--                    THEN COALESCE(po2.review_fee_amount, 0) ELSE 0 END)
--           * (COALESCE((d.percentage::TEXT)::NUMERIC, 50) / 100)
--           - COALESCE(po2.materials_cost, 0)
--             * (GREATEST(0, LEAST(100, (d.materials_share::TEXT)::NUMERIC)) / 100)
--         )
--       END, 2) AS share_correct
--   FROM public.patient_operations po2
--   JOIN _helu_clinic c ON c.id = po2.clinic_id
--   JOIN public.doctors d ON d.id = po2.doctor_id
--   WHERE COALESCE(po2.paid_amount, 0) > 0
--     AND COALESCE(po2.session_kind, '') NOT IN ('refund', 'discount')
-- ) sub
-- WHERE po.id = sub.id
--   AND ABS(COALESCE(po.doctor_share_amount, 0) - sub.share_correct) > 1.01;

-- ALTER TABLE public.patient_operations ENABLE TRIGGER USER;

-- COMMIT;


-- ═══════════════════════════════════════════════════════════════════════════
-- 5) تحقق نهائي — رصيد كل طبيب في الحلو بعد الإصلاح
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  d.full_name_ar AS doctor_name,
  d.percentage AS doctor_pct,
  (public.get_doctor_wallet_stats(d.id) ->> 'total_earnings')::numeric AS total_earnings,
  (public.get_doctor_wallet_stats(d.id) ->> 'available_balance')::numeric AS available_balance
FROM public.doctors d
JOIN _helu_clinic c ON c.id = d.clinic_id
ORDER BY d.full_name_ar;

NOTIFY pgrst, 'reload schema';
