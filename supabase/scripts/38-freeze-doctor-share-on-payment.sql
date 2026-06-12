-- تجميد حصة الطبيب عند كل دفعة — تغيير النسبة لا يعيد حساب الدفعات السابقة

-- أعمدة مطلوبة لـ apply_review_fee (تُطلَب عند UPDATE على patient_operations)
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS review_fee_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS review_fee_amount DECIMAL(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.operation_types
  ADD COLUMN IF NOT EXISTS review_fee_amount DECIMAL(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.patient_operations
  ADD COLUMN IF NOT EXISTS review_fee_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_review_statement BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.calc_doctor_operation_earned(
  p_doctor_id UUID,
  p_doctor_share_amount NUMERIC,
  p_paid_amount NUMERIC,
  p_treatment_case_id UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_share NUMERIC;
  v_paid NUMERIC;
  v_case_doc NUMERIC;
  v_case_final NUMERIC;
BEGIN
  v_share := COALESCE(p_doctor_share_amount, 0);
  IF v_share <> 0 THEN
    RETURN ROUND(v_share, 2);
  END IF;

  v_paid := COALESCE(p_paid_amount, 0);
  IF v_paid = 0 THEN
    RETURN 0;
  END IF;

  -- احتياطي للسجلات القديمة قبل التجميد (لا يستخدم نسبة الطبيب الحالية)
  IF p_treatment_case_id IS NOT NULL THEN
    SELECT doctor_share_total, final_price
    INTO v_case_doc, v_case_final
    FROM public.patient_treatment_cases
    WHERE id = p_treatment_case_id;

    IF COALESCE(v_case_final, 0) > 0 THEN
      RETURN ROUND(v_paid * (COALESCE(v_case_doc, 0) / v_case_final), 2);
    END IF;
  END IF;

  RETURN 0;
END;
$$;

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

  SELECT COALESCE(NULLIF(d.payment_type, ''), 'percentage')
  INTO v_payment_type
  FROM public.doctors d
  WHERE d.id = NEW.doctor_id;

  IF COALESCE(v_payment_type, 'percentage') = 'salary' THEN
    NEW.doctor_share_amount := 0;
    NEW.clinic_share_amount := ROUND(COALESCE(NEW.paid_amount, 0), 2);
  ELSIF NEW.treatment_case_id IS NOT NULL AND COALESCE(NEW.paid_amount, 0) > 0 THEN
    SELECT doctor_share_total, clinic_share_total, final_price
    INTO v_case_doc, v_case_clinic, v_case_final
    FROM public.patient_treatment_cases
    WHERE id = NEW.treatment_case_id;

    IF COALESCE(v_case_final, 0) > 0 THEN
      NEW.doctor_share_amount := ROUND(
        NEW.paid_amount * COALESCE(v_case_doc, 0) / v_case_final,
        2
      );
      NEW.clinic_share_amount := ROUND(
        NEW.paid_amount * COALESCE(v_case_clinic, 0) / v_case_final,
        2
      );
    ELSE
      NEW.doctor_share_amount := 0;
      NEW.clinic_share_amount := 0;
    END IF;
  ELSIF v_agreed > 0 AND COALESCE(NEW.paid_amount, 0) > 0 THEN
    SELECT doctor_share_total, clinic_share_total
    INTO v_patient_doc, v_patient_clinic
    FROM public.patients
    WHERE id = NEW.patient_id;

    NEW.doctor_share_amount := ROUND(
      NEW.paid_amount * COALESCE(v_patient_doc, 0) / v_agreed,
      2
    );
    NEW.clinic_share_amount := ROUND(
      NEW.paid_amount * COALESCE(v_patient_clinic, 0) / v_agreed,
      2
    );
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

-- تعبئة حصص الدفعات القديمة (حيث كانت 0 في الـ trigger)
-- تعطيل triggers مؤقتاً حتى لا يفشل apply_review_fee أثناء التحديث الجماعي
ALTER TABLE public.patient_operations DISABLE TRIGGER USER;

UPDATE public.patient_operations po
SET
  doctor_share_amount = sub.doc_share,
  clinic_share_amount = sub.clinic_share
FROM (
  SELECT
    po2.id,
    ROUND(
      COALESCE(po2.paid_amount, 0)
      * COALESCE(ptc.doctor_share_total, 0)
      / NULLIF(ptc.final_price, 0),
      2
    ) AS doc_share,
    ROUND(
      COALESCE(po2.paid_amount, 0)
      * COALESCE(ptc.clinic_share_total, 0)
      / NULLIF(ptc.final_price, 0),
      2
    ) AS clinic_share
  FROM public.patient_operations po2
  JOIN public.patient_treatment_cases ptc ON ptc.id = po2.treatment_case_id
  WHERE COALESCE(po2.paid_amount, 0) > 0
    AND COALESCE(po2.doctor_share_amount, 0) = 0
    AND COALESCE(ptc.final_price, 0) > 0
    AND po2.session_kind IN ('payment', 'plan')
) sub
WHERE po.id = sub.id
  AND sub.doc_share IS NOT NULL;

UPDATE public.patient_operations po
SET
  doctor_share_amount = sub.doc_share,
  clinic_share_amount = sub.clinic_share
FROM (
  SELECT
    po2.id,
    ROUND(
      COALESCE(po2.paid_amount, 0)
      * COALESCE(p.doctor_share_total, 0)
      / NULLIF(p.agreed_total, 0),
      2
    ) AS doc_share,
    ROUND(
      COALESCE(po2.paid_amount, 0)
      * COALESCE(p.clinic_share_total, 0)
      / NULLIF(p.agreed_total, 0),
      2
    ) AS clinic_share
  FROM public.patient_operations po2
  JOIN public.patients p ON p.id = po2.patient_id
  WHERE po2.treatment_case_id IS NULL
    AND COALESCE(po2.paid_amount, 0) > 0
    AND COALESCE(po2.doctor_share_amount, 0) = 0
    AND COALESCE(p.agreed_total, 0) > 0
    AND po2.session_kind IN ('payment', 'plan')
) sub
WHERE po.id = sub.id
  AND sub.doc_share IS NOT NULL;

ALTER TABLE public.patient_operations ENABLE TRIGGER USER;

GRANT EXECUTE ON FUNCTION public.calc_doctor_operation_earned(UUID, NUMERIC, NUMERIC, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calc_doctor_operation_earned(UUID, NUMERIC, NUMERIC, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
