-- كشفية المراجع — شغّل في Supabase → SQL Editor (انسخ الملف كاملاً)

-- نفس: supabase/migrations/20260603230000_review_fee_fix.sql

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

  IF NEW.operation_type_id IS NOT NULL THEN
    SELECT review_fee_amount INTO v_type_fee
    FROM public.operation_types
    WHERE id = NEW.operation_type_id;

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

DROP TRIGGER IF EXISTS trg_apply_review_fee ON public.patient_operations;
CREATE TRIGGER trg_apply_review_fee
  BEFORE INSERT OR UPDATE ON public.patient_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_review_fee();

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
  v_review_fee    NUMERIC;
  v_plan_total    NUMERIC;
BEGIN
  SELECT agreed_total, total_paid, financial_locked
  INTO v_agreed, v_total_paid, v_locked
  FROM public.patients
  WHERE id = NEW.patient_id;

  v_agreed := COALESCE(v_agreed, 0);
  v_total_paid := COALESCE(v_total_paid, 0);
  v_review_fee := COALESCE(NEW.review_fee_amount, 0);

  v_is_plan := (
    NEW.session_kind = 'plan'
    OR (COALESCE(NEW.total_amount, 0) > 0 AND NOT COALESCE(v_locked, FALSE))
  );

  IF v_is_plan AND (COALESCE(NEW.total_amount, 0) > 0 OR v_review_fee > 0) THEN
    v_plan_total := COALESCE(NEW.total_amount, 0) + v_review_fee;

    SELECT
      (d.percentage::TEXT)::NUMERIC / 100,
      (d.materials_share::TEXT)::NUMERIC / 100
    INTO v_doc_pct, v_mat_share
    FROM public.doctors d
    WHERE d.id = NEW.doctor_id;

    v_doc_gross := COALESCE(NEW.total_amount, 0) * v_doc_pct;
    v_doc_share := v_doc_gross - (COALESCE(NEW.materials_cost, 0) * v_mat_share);
    v_clinic_share := (COALESCE(NEW.total_amount, 0) - v_doc_share) + v_review_fee;

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
    NEW.doctor_share_amount := 0;
    NEW.clinic_share_amount := 0;
    NEW.remaining_debt := GREATEST(0, v_plan_total - v_total_paid);

    RETURN NEW;
  END IF;

  NEW.session_kind := 'payment';
  NEW.total_amount := 0;
  NEW.doctor_share_amount := 0;
  NEW.clinic_share_amount := 0;
  NEW.materials_cost := COALESCE(NEW.materials_cost, 0);

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

DROP TRIGGER IF EXISTS trg_calculate_operation_shares ON public.patient_operations;
CREATE TRIGGER trg_calculate_operation_shares
  BEFORE INSERT OR UPDATE ON public.patient_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.calculate_operation_shares();

NOTIFY pgrst, 'reload schema';
