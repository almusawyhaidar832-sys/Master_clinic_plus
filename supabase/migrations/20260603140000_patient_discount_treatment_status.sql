-- Discount on agreed total + auto-close case when fully paid

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS original_agreed_total DECIMAL(12, 2) NOT NULL DEFAULT 0
    CHECK (original_agreed_total >= 0),
  ADD COLUMN IF NOT EXISTS discount_total DECIMAL(12, 2) NOT NULL DEFAULT 0
    CHECK (discount_total >= 0),
  ADD COLUMN IF NOT EXISTS treatment_status TEXT NOT NULL DEFAULT 'active'
    CHECK (treatment_status IN ('active', 'completed'));

COMMENT ON COLUMN public.patients.treatment_status IS
  'active = debt may remain; completed = agreed total fully paid';
COMMENT ON COLUMN public.patients.discount_total IS
  'Cumulative discounts applied to original agreed price';

ALTER TABLE public.patient_operations
  ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(12, 2) NOT NULL DEFAULT 0
    CHECK (discount_amount >= 0);

ALTER TABLE public.patient_operations
  DROP CONSTRAINT IF EXISTS patient_operations_session_kind_check;

ALTER TABLE public.patient_operations
  ADD CONSTRAINT patient_operations_session_kind_check
  CHECK (session_kind IN ('plan', 'payment', 'discount'));

-- Backfill original from current agreed where missing
UPDATE public.patients
SET original_agreed_total = agreed_total
WHERE original_agreed_total = 0 AND agreed_total > 0;

UPDATE public.patients
SET treatment_status = 'completed'
WHERE agreed_total > 0
  AND total_paid >= agreed_total
  AND treatment_status = 'active';

DROP TRIGGER IF EXISTS trg_calculate_operation_shares ON public.patient_operations;
DROP FUNCTION IF EXISTS public.calculate_operation_shares() CASCADE;

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
BEGIN
  SELECT agreed_total, total_paid, financial_locked
  INTO v_agreed, v_total_paid, v_locked
  FROM public.patients
  WHERE id = NEW.patient_id;

  v_agreed := COALESCE(v_agreed, 0);
  v_total_paid := COALESCE(v_total_paid, 0);

  -- Discount session: reduce agreed total (e.g. 150k → 100k after 50k discount)
  IF NEW.session_kind = 'discount' AND COALESCE(NEW.discount_amount, 0) > 0 THEN
    v_old_agreed := v_agreed;
    v_discount := NEW.discount_amount;
    v_new_agreed := GREATEST(0, v_old_agreed - v_discount);

    IF v_old_agreed > 0 THEN
      v_ratio := CASE WHEN v_old_agreed > 0 THEN v_new_agreed / v_old_agreed ELSE 0 END;
      UPDATE public.patients
      SET
        discount_total = COALESCE(discount_total, 0) + v_discount,
        agreed_total = v_new_agreed,
        doctor_share_total = ROUND(COALESCE(doctor_share_total, 0) * v_ratio, 2),
        clinic_share_total = ROUND(COALESCE(clinic_share_total, 0) * v_ratio, 2)
      WHERE id = NEW.patient_id;
    END IF;

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
    END IF;

    RETURN NEW;
  END IF;

  v_is_plan := (
    NEW.session_kind = 'plan'
    OR (COALESCE(NEW.total_amount, 0) > 0 AND NOT COALESCE(v_locked, FALSE))
  );

  IF v_is_plan AND COALESCE(NEW.total_amount, 0) > 0 THEN
    SELECT
      (d.percentage::TEXT)::NUMERIC / 100,
      (d.materials_share::TEXT)::NUMERIC / 100
    INTO v_doc_pct, v_mat_share
    FROM public.doctors d
    WHERE d.id = NEW.doctor_id;

    v_doc_gross := NEW.total_amount * v_doc_pct;
    v_doc_share := v_doc_gross - (COALESCE(NEW.materials_cost, 0) * v_mat_share);
    v_clinic_share := NEW.total_amount - v_doc_share;

    UPDATE public.patients
    SET
      agreed_total = NEW.total_amount,
      original_agreed_total = NEW.total_amount,
      discount_total = 0,
      doctor_share_total = ROUND(v_doc_share::NUMERIC, 2),
      clinic_share_total = ROUND(v_clinic_share::NUMERIC, 2),
      previous_total = NEW.total_amount,
      financial_locked = TRUE,
      treatment_status = 'active',
      total_paid = total_paid + COALESCE(NEW.paid_amount, 0)
    WHERE id = NEW.patient_id;

    SELECT total_paid, agreed_total INTO v_total_paid, v_agreed
    FROM public.patients WHERE id = NEW.patient_id;

    NEW.session_kind := 'plan';
    NEW.doctor_share_amount := 0;
    NEW.clinic_share_amount := 0;
    NEW.remaining_debt := GREATEST(0, v_agreed - v_total_paid);

    IF v_agreed > 0 AND v_total_paid >= v_agreed THEN
      UPDATE public.patients SET treatment_status = 'completed' WHERE id = NEW.patient_id;
    END IF;

    RETURN NEW;
  END IF;

  -- Payment session
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
