-- ربط الجلسات القديمة بحالات العلاج + تصحيح status و total_paid
-- شغّل مرة واحدة في Supabase SQL Editor
-- قاعدة البيانات تستخدم operation_name_ar فقط (لا operation_type ولا operation_type_id)

-- ============================================================
-- 0) إصلاح trigger كشفية المراجع (كان يطلب operation_type_id)
-- ============================================================
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS review_fee_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS review_fee_amount DECIMAL(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.patient_operations
  ADD COLUMN IF NOT EXISTS review_fee_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_review_statement BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.apply_review_fee()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic_fee DECIMAL(12, 2);
  v_type_fee DECIMAL(12, 2);
BEGIN
  NEW.review_fee_amount := COALESCE(NEW.review_fee_amount, 0);

  IF NOT COALESCE(NEW.is_review_statement, FALSE) THEN
    NEW.review_fee_amount := 0;
    RETURN NEW;
  END IF;

  IF NEW.review_fee_amount > 0 THEN
    RETURN NEW;
  END IF;

  IF COALESCE(TRIM(NEW.operation_name_ar), '') <> '' THEN
    SELECT ot.review_fee_amount INTO v_type_fee
    FROM public.operation_types ot
    WHERE ot.clinic_id = NEW.clinic_id
      AND lower(trim(ot.name_ar)) = lower(trim(NEW.operation_name_ar))
    LIMIT 1;

    IF v_type_fee IS NOT NULL AND v_type_fee > 0 THEN
      NEW.review_fee_amount := v_type_fee;
      RETURN NEW;
    END IF;
  END IF;

  SELECT c.review_fee_amount INTO v_clinic_fee
  FROM public.clinics c
  WHERE c.id = NEW.clinic_id AND c.review_fee_enabled = TRUE;

  NEW.review_fee_amount := COALESCE(v_clinic_fee, 0);
  RETURN NEW;
END;
$$;

-- ============================================================
-- 1) ربط الجلسات — تعطيل triggers مؤقتاً حتى لا تتغير المبالغ
-- ============================================================
ALTER TABLE public.patient_operations
  ADD COLUMN IF NOT EXISTS treatment_case_id UUID
    REFERENCES public.patient_treatment_cases(id) ON DELETE SET NULL;

-- فك ربط خاطئ (الاسم لا يطابق الحالة)
UPDATE public.patient_operations po
SET treatment_case_id = NULL
FROM public.patient_treatment_cases c
WHERE po.treatment_case_id = c.id
  AND po.patient_id = c.patient_id
  AND lower(trim(coalesce(nullif(trim(po.operation_name_ar), ''), 'علاج')))
    <> lower(trim(c.treatment_name_ar));

ALTER TABLE public.patient_operations DISABLE TRIGGER USER;

UPDATE public.patient_operations po
SET treatment_case_id = match.case_id
FROM (
  SELECT DISTINCT ON (po2.id)
    po2.id AS op_id,
    c.id AS case_id
  FROM public.patient_operations po2
  INNER JOIN public.patient_treatment_cases c
    ON po2.patient_id = c.patient_id
  WHERE lower(trim(coalesce(nullif(trim(po2.operation_name_ar), ''), 'علاج')))
    = lower(trim(c.treatment_name_ar))
  ORDER BY po2.id, c.created_at ASC
) AS match
WHERE po.id = match.op_id;

ALTER TABLE public.patient_operations ENABLE TRIGGER USER;

-- ============================================================
-- 2) إعادة حساب total_paid و status (مع تصحيح تكرار الدفعات)
-- ============================================================
UPDATE public.patient_treatment_cases c
SET
  total_paid = sub.corrected_paid,
  status = CASE
    WHEN sub.corrected_paid >= c.final_price - 0.01
      AND c.final_price > 0
      AND sub.plan_remaining <= 0.01
    THEN 'completed'
    ELSE 'active'
  END,
  updated_at = NOW()
FROM (
  SELECT
    c2.id AS case_id,
    COALESCE(SUM(po.paid_amount), 0) AS sum_paid,
    COALESCE((
      SELECT GREATEST(
        0,
        COALESCE(po3.remaining_debt, po3.total_amount - po3.paid_amount)
      )
      FROM public.patient_operations po3
      WHERE po3.treatment_case_id = c2.id
        AND COALESCE(po3.total_amount, 0) > 0
      ORDER BY po3.created_at DESC
      LIMIT 1
    ), 0) AS plan_remaining,
    CASE
      WHEN COALESCE(SUM(po.paid_amount), 0) >= c2.final_price - 0.01
        AND c2.final_price > 0
        AND COALESCE((
          SELECT GREATEST(
            0,
            COALESCE(po3.remaining_debt, po3.total_amount - po3.paid_amount)
          )
          FROM public.patient_operations po3
          WHERE po3.treatment_case_id = c2.id
            AND COALESCE(po3.total_amount, 0) > 0
          ORDER BY po3.created_at DESC
          LIMIT 1
        ), 0) > 0.01
        AND c2.final_price - COALESCE((
          SELECT GREATEST(
            0,
            COALESCE(po3.remaining_debt, po3.total_amount - po3.paid_amount)
          )
          FROM public.patient_operations po3
          WHERE po3.treatment_case_id = c2.id
            AND COALESCE(po3.total_amount, 0) > 0
          ORDER BY po3.created_at DESC
          LIMIT 1
        ), 0) < COALESCE(SUM(po.paid_amount), 0) - 0.01
      THEN GREATEST(
        0,
        c2.final_price - COALESCE((
          SELECT GREATEST(
            0,
            COALESCE(po3.remaining_debt, po3.total_amount - po3.paid_amount)
          )
          FROM public.patient_operations po3
          WHERE po3.treatment_case_id = c2.id
            AND COALESCE(po3.total_amount, 0) > 0
          ORDER BY po3.created_at DESC
          LIMIT 1
        ), 0)
      )
      ELSE LEAST(COALESCE(SUM(po.paid_amount), 0), c2.final_price)
    END AS corrected_paid
  FROM public.patient_treatment_cases c2
  LEFT JOIN public.patient_operations po ON po.treatment_case_id = c2.id
  GROUP BY c2.id, c2.final_price
) sub
WHERE c.id = sub.case_id;

-- ============================================================
-- 3) حالات status خاطئ (مكتملة لكن فيها ذمة)
-- ============================================================
UPDATE public.patient_treatment_cases
SET status = 'active', updated_at = NOW()
WHERE status = 'completed'
  AND final_price > total_paid + 0.01;

NOTIFY pgrst, 'reload schema';

SELECT 'link-operations-to-treatment-cases done' AS status;
