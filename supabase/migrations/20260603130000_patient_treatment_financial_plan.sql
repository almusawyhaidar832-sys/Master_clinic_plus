-- Treatment-level profit split (once per patient) + payment sessions (no re-split)

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS agreed_total DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (agreed_total >= 0),
  ADD COLUMN IF NOT EXISTS doctor_share_total DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (doctor_share_total >= 0),
  ADD COLUMN IF NOT EXISTS clinic_share_total DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (clinic_share_total >= 0),
  ADD COLUMN IF NOT EXISTS total_paid DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (total_paid >= 0),
  ADD COLUMN IF NOT EXISTS financial_locked BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.patient_operations
  ADD COLUMN IF NOT EXISTS session_kind TEXT NOT NULL DEFAULT 'payment'
    CHECK (session_kind IN ('plan', 'payment'));

COMMENT ON COLUMN public.patients.agreed_total IS
  'Total agreed amount for treatment — profit split calculated once on this';
COMMENT ON COLUMN public.patient_operations.session_kind IS
  'plan = set agreed total + split once; payment = paid_amount only, no new shares';

-- Replace per-session share trigger
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
BEGIN
  SELECT agreed_total, total_paid, financial_locked
  INTO v_agreed, v_total_paid, v_locked
  FROM public.patients
  WHERE id = NEW.patient_id;

  v_agreed := COALESCE(v_agreed, 0);
  v_total_paid := COALESCE(v_total_paid, 0);

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
      doctor_share_total = ROUND(v_doc_share::NUMERIC, 2),
      clinic_share_total = ROUND(v_clinic_share::NUMERIC, 2),
      previous_total = NEW.total_amount,
      financial_locked = TRUE,
      total_paid = total_paid + COALESCE(NEW.paid_amount, 0)
    WHERE id = NEW.patient_id;

    SELECT total_paid INTO v_total_paid FROM public.patients WHERE id = NEW.patient_id;

    NEW.session_kind := 'plan';
    NEW.doctor_share_amount := 0;
    NEW.clinic_share_amount := 0;
    NEW.remaining_debt := GREATEST(0, NEW.total_amount - v_total_paid);

    RETURN NEW;
  END IF;

  -- Payment session: no profit re-split — only reduce remaining balance
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

CREATE TRIGGER trg_calculate_operation_shares
  BEFORE INSERT OR UPDATE ON public.patient_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.calculate_operation_shares();

NOTIFY pgrst, 'reload schema';
