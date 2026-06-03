-- Fix: column "previous_total" of relation "patients" does not exist
-- Also: new treatment case when patient already has financial_locked

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS previous_total DECIMAL(12, 2) NOT NULL DEFAULT 0
    CHECK (previous_total >= 0);

COMMENT ON COLUMN public.patients.previous_total IS
  'Last plan case_price — used by legacy trigger; multi-case uses patient_treatment_cases';

-- Ensure other columns referenced by calculate_operation_shares exist
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS agreed_total DECIMAL(12, 2) NOT NULL DEFAULT 0
    CHECK (agreed_total >= 0),
  ADD COLUMN IF NOT EXISTS original_agreed_total DECIMAL(12, 2) NOT NULL DEFAULT 0
    CHECK (original_agreed_total >= 0),
  ADD COLUMN IF NOT EXISTS discount_total DECIMAL(12, 2) NOT NULL DEFAULT 0
    CHECK (discount_total >= 0),
  ADD COLUMN IF NOT EXISTS doctor_share_total DECIMAL(12, 2) NOT NULL DEFAULT 0
    CHECK (doctor_share_total >= 0),
  ADD COLUMN IF NOT EXISTS clinic_share_total DECIMAL(12, 2) NOT NULL DEFAULT 0
    CHECK (clinic_share_total >= 0),
  ADD COLUMN IF NOT EXISTS total_paid DECIMAL(12, 2) NOT NULL DEFAULT 0
    CHECK (total_paid >= 0),
  ADD COLUMN IF NOT EXISTS financial_locked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS treatment_status TEXT NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'patients_treatment_status_check'
  ) THEN
    ALTER TABLE public.patients
      ADD CONSTRAINT patients_treatment_status_check
      CHECK (treatment_status IN ('active', 'completed'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.calculate_operation_shares()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agreed        NUMERIC;
  v_total_paid    NUMERIC;
  v_locked        BOOLEAN;
  v_doc_pct       NUMERIC := 0.5;
  v_mat_share     NUMERIC := 0;
  v_doc_gross     NUMERIC;
  v_doc_share     NUMERIC;
  v_clinic_share  NUMERIC;
  v_is_plan       BOOLEAN;
  v_old_agreed    NUMERIC;
  v_discount      NUMERIC;
  v_new_agreed    NUMERIC;
  v_ratio         NUMERIC;
  v_case_price    NUMERIC;
  v_plan_discount NUMERIC;
  v_final_price   NUMERIC;
BEGIN
  SELECT agreed_total, total_paid, financial_locked
  INTO v_agreed, v_total_paid, v_locked
  FROM public.patients
  WHERE id = NEW.patient_id;

  v_agreed := COALESCE(v_agreed, 0);
  v_total_paid := COALESCE(v_total_paid, 0);

  IF NEW.session_kind = 'discount' AND COALESCE(NEW.discount_amount, 0) > 0 THEN
    v_old_agreed := v_agreed;
    v_discount := NEW.discount_amount;
    v_new_agreed := GREATEST(0, v_old_agreed - v_discount);

    IF v_old_agreed > 0 AND NOT COALESCE(v_locked, FALSE) THEN
      v_ratio := v_new_agreed / v_old_agreed;
      UPDATE public.patients
      SET
        discount_total = COALESCE(discount_total, 0) + v_discount,
        agreed_total = v_new_agreed,
        doctor_share_total = ROUND(COALESCE(doctor_share_total, 0) * v_ratio, 2),
        clinic_share_total = ROUND(COALESCE(clinic_share_total, 0) * v_ratio, 2)
      WHERE id = NEW.patient_id;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'sync_patient_treatment_plan'
    ) THEN
      PERFORM public.sync_patient_treatment_plan(NEW.patient_id);
    END IF;

    SELECT agreed_total, total_paid INTO v_agreed, v_total_paid
    FROM public.patients WHERE id = NEW.patient_id;

    NEW.session_kind := 'discount';
    NEW.total_amount := 0;
    NEW.paid_amount := 0;
    NEW.doctor_share_amount := 0;
    NEW.clinic_share_amount := 0;
    NEW.remaining_debt := GREATEST(0, v_agreed - v_total_paid);

    IF v_agreed > 0 AND v_total_paid >= v_agreed AND NOT COALESCE(v_locked, FALSE) THEN
      UPDATE public.patients SET treatment_status = 'completed' WHERE id = NEW.patient_id;
      IF EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'sync_patient_treatment_plan'
      ) THEN
        PERFORM public.sync_patient_treatment_plan(NEW.patient_id);
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  v_is_plan := (
    NEW.session_kind = 'plan'
    OR (COALESCE(NEW.total_amount, 0) > 0 AND NOT COALESCE(v_locked, FALSE))
  );

  IF v_is_plan AND COALESCE(NEW.total_amount, 0) > 0 THEN
    v_case_price := NEW.total_amount;
    v_plan_discount := COALESCE(NEW.discount_amount, 0);
    v_final_price := GREATEST(0, v_case_price - v_plan_discount);

    SELECT
      (d.percentage::TEXT)::NUMERIC / 100,
      (d.materials_share::TEXT)::NUMERIC / 100
    INTO v_doc_pct, v_mat_share
    FROM public.doctors d
    WHERE d.id = NEW.doctor_id;

    v_doc_gross := v_final_price * v_doc_pct;
    v_doc_share := v_doc_gross - (COALESCE(NEW.materials_cost, 0) * v_mat_share);
    v_clinic_share := v_final_price - v_doc_share;

    -- مريض عنده حالة سابقة (financial_locked): حالة جديدة في patient_treatment_cases فقط
    IF COALESCE(v_locked, FALSE) THEN
      NEW.session_kind := 'plan';
      NEW.doctor_share_amount := ROUND(v_doc_share::NUMERIC, 2);
      NEW.clinic_share_amount := ROUND(v_clinic_share::NUMERIC, 2);
      NEW.remaining_debt := GREATEST(
        0,
        v_final_price - COALESCE(NEW.paid_amount, 0)
      );
      RETURN NEW;
    END IF;

    UPDATE public.patients
    SET
      agreed_total = v_final_price,
      original_agreed_total = v_case_price,
      discount_total = v_plan_discount,
      doctor_share_total = ROUND(v_doc_share::NUMERIC, 2),
      clinic_share_total = ROUND(v_clinic_share::NUMERIC, 2),
      previous_total = v_case_price,
      financial_locked = TRUE,
      treatment_status = 'active',
      total_paid = total_paid + COALESCE(NEW.paid_amount, 0)
    WHERE id = NEW.patient_id;

    SELECT total_paid, agreed_total INTO v_total_paid, v_agreed
    FROM public.patients WHERE id = NEW.patient_id;

    IF EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'sync_patient_treatment_plan'
    ) THEN
      PERFORM public.sync_patient_treatment_plan(NEW.patient_id);
    END IF;

    NEW.session_kind := 'plan';
    NEW.doctor_share_amount := 0;
    NEW.clinic_share_amount := 0;
    NEW.remaining_debt := GREATEST(0, v_agreed - v_total_paid);

    IF v_agreed > 0 AND v_total_paid >= v_agreed THEN
      UPDATE public.patients SET treatment_status = 'completed' WHERE id = NEW.patient_id;
      IF EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'sync_patient_treatment_plan'
      ) THEN
        PERFORM public.sync_patient_treatment_plan(NEW.patient_id);
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  NEW.session_kind := 'payment';
  NEW.total_amount := 0;
  NEW.doctor_share_amount := 0;
  NEW.clinic_share_amount := 0;
  NEW.materials_cost := COALESCE(NEW.materials_cost, 0);

  IF v_agreed > 0 AND NOT COALESCE(v_locked, FALSE) THEN
    UPDATE public.patients
    SET total_paid = total_paid + COALESCE(NEW.paid_amount, 0)
    WHERE id = NEW.patient_id;

    SELECT total_paid, agreed_total INTO v_total_paid, v_agreed
    FROM public.patients WHERE id = NEW.patient_id;

    NEW.remaining_debt := GREATEST(0, v_agreed - v_total_paid);

    IF v_agreed > 0 AND v_total_paid >= v_agreed THEN
      UPDATE public.patients SET treatment_status = 'completed' WHERE id = NEW.patient_id;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'sync_patient_treatment_plan'
    ) THEN
      PERFORM public.sync_patient_treatment_plan(NEW.patient_id);
    END IF;
  ELSE
    NEW.remaining_debt := GREATEST(0, COALESCE(NEW.total_amount, 0) - COALESCE(NEW.paid_amount, 0));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_calculate_operation_shares ON public.patient_operations;
CREATE TRIGGER trg_calculate_operation_shares
  BEFORE INSERT OR UPDATE ON public.patient_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.calculate_operation_shares();

NOTIFY pgrst, 'reload schema';
