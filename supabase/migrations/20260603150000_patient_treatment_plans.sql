-- One treatment plan per patient: case price + discount (once) → final price

CREATE TABLE IF NOT EXISTS public.patient_treatment_plans (
  patient_id UUID PRIMARY KEY REFERENCES public.patients(id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  case_price DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (case_price >= 0),
  discount_total DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  final_price DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (final_price >= 0),
  doctor_share_total DECIMAL(12, 2) NOT NULL DEFAULT 0,
  clinic_share_total DECIMAL(12, 2) NOT NULL DEFAULT 0,
  total_paid DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (total_paid >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  locked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_treatment_plans_clinic
  ON public.patient_treatment_plans(clinic_id);

COMMENT ON TABLE public.patient_treatment_plans IS
  'Single financial plan per patient: case_price - discount = final_price; payments reduce remaining';

-- Backfill from patients
INSERT INTO public.patient_treatment_plans (
  patient_id,
  clinic_id,
  case_price,
  discount_total,
  final_price,
  doctor_share_total,
  clinic_share_total,
  total_paid,
  status,
  locked_at
)
SELECT
  p.id,
  p.clinic_id,
  COALESCE(NULLIF(p.original_agreed_total, 0), p.agreed_total, 0),
  COALESCE(p.discount_total, 0),
  COALESCE(p.agreed_total, 0),
  COALESCE(p.doctor_share_total, 0),
  COALESCE(p.clinic_share_total, 0),
  COALESCE(p.total_paid, 0),
  COALESCE(p.treatment_status, 'active'),
  CASE WHEN p.financial_locked THEN NOW() ELSE NULL END
FROM public.patients p
WHERE COALESCE(p.agreed_total, 0) > 0
   OR COALESCE(p.financial_locked, FALSE)
ON CONFLICT (patient_id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_calculate_operation_shares ON public.patient_operations;
DROP FUNCTION IF EXISTS public.calculate_operation_shares() CASCADE;

CREATE OR REPLACE FUNCTION public.sync_patient_treatment_plan(p_patient_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_p RECORD;
BEGIN
  SELECT
    clinic_id,
    COALESCE(NULLIF(original_agreed_total, 0), agreed_total, 0) AS case_price,
    COALESCE(discount_total, 0) AS discount_total,
    COALESCE(agreed_total, 0) AS final_price,
    COALESCE(doctor_share_total, 0) AS doctor_share_total,
    COALESCE(clinic_share_total, 0) AS clinic_share_total,
    COALESCE(total_paid, 0) AS total_paid,
    COALESCE(treatment_status, 'active') AS status,
    financial_locked
  INTO v_p
  FROM public.patients
  WHERE id = p_patient_id;

  IF NOT FOUND OR v_p.final_price <= 0 AND NOT v_p.financial_locked THEN
    RETURN;
  END IF;

  INSERT INTO public.patient_treatment_plans (
    patient_id,
    clinic_id,
    case_price,
    discount_total,
    final_price,
    doctor_share_total,
    clinic_share_total,
    total_paid,
    status,
    locked_at,
    updated_at
  )
  VALUES (
    p_patient_id,
    v_p.clinic_id,
    v_p.case_price,
    v_p.discount_total,
    v_p.final_price,
    v_p.doctor_share_total,
    v_p.clinic_share_total,
    v_p.total_paid,
    v_p.status,
    CASE WHEN v_p.financial_locked THEN NOW() ELSE NULL END,
    NOW()
  )
  ON CONFLICT (patient_id) DO UPDATE SET
    case_price = EXCLUDED.case_price,
    discount_total = EXCLUDED.discount_total,
    final_price = EXCLUDED.final_price,
    doctor_share_total = EXCLUDED.doctor_share_total,
    clinic_share_total = EXCLUDED.clinic_share_total,
    total_paid = EXCLUDED.total_paid,
    status = EXCLUDED.status,
    locked_at = COALESCE(EXCLUDED.locked_at, patient_treatment_plans.locked_at),
    updated_at = NOW();
END;
$$;

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

    IF v_old_agreed > 0 THEN
      v_ratio := v_new_agreed / v_old_agreed;
      UPDATE public.patients
      SET
        discount_total = COALESCE(discount_total, 0) + v_discount,
        agreed_total = v_new_agreed,
        doctor_share_total = ROUND(COALESCE(doctor_share_total, 0) * v_ratio, 2),
        clinic_share_total = ROUND(COALESCE(clinic_share_total, 0) * v_ratio, 2)
      WHERE id = NEW.patient_id;
    END IF;

    PERFORM public.sync_patient_treatment_plan(NEW.patient_id);

    SELECT agreed_total, total_paid INTO v_agreed, v_total_paid
    FROM public.patients WHERE id = NEW.patient_id;

    NEW.session_kind := 'discount';
    NEW.total_amount := 0;
    NEW.paid_amount := 0;
    NEW.doctor_share_amount := 0;
    NEW.clinic_share_amount := 0;
    NEW.remaining_debt := GREATEST(0, v_agreed - v_total_paid);

    IF v_agreed > 0 AND v_total_paid >= v_agreed THEN
      UPDATE public.patients SET treatment_status = 'completed' WHERE id = NEW.patient_id;
      PERFORM public.sync_patient_treatment_plan(NEW.patient_id);
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

    PERFORM public.sync_patient_treatment_plan(NEW.patient_id);

    NEW.session_kind := 'plan';
    NEW.doctor_share_amount := 0;
    NEW.clinic_share_amount := 0;
    NEW.remaining_debt := GREATEST(0, v_agreed - v_total_paid);

    IF v_agreed > 0 AND v_total_paid >= v_agreed THEN
      UPDATE public.patients SET treatment_status = 'completed' WHERE id = NEW.patient_id;
      PERFORM public.sync_patient_treatment_plan(NEW.patient_id);
    END IF;

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

    SELECT total_paid, agreed_total INTO v_total_paid, v_agreed
    FROM public.patients WHERE id = NEW.patient_id;

    NEW.remaining_debt := GREATEST(0, v_agreed - v_total_paid);

    IF v_agreed > 0 AND v_total_paid >= v_agreed THEN
      UPDATE public.patients SET treatment_status = 'completed' WHERE id = NEW.patient_id;
    END IF;

    PERFORM public.sync_patient_treatment_plan(NEW.patient_id);
  ELSE
    NEW.remaining_debt := GREATEST(0, COALESCE(NEW.total_amount, 0) - COALESCE(NEW.paid_amount, 0));
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_calculate_operation_shares
  BEFORE INSERT OR UPDATE ON public.patient_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.calculate_operation_shares();

NOTIFY pgrst, 'reload schema';
