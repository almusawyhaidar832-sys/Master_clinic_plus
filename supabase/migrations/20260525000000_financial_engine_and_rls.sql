-- Master Clinic Plus — Financial engine, wallet RPCs, RLS fixes, review fee

-- =============================================================================
-- ENUMS & COLUMNS
-- =============================================================================
DO $$ BEGIN
  CREATE TYPE public.withdrawal_source AS ENUM ('doctor_request', 'accountant_cash');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.doctor_withdrawals
  ADD COLUMN IF NOT EXISTS source public.withdrawal_source NOT NULL DEFAULT 'doctor_request';

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS review_fee_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS review_fee_amount DECIMAL(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.operation_types
  ADD COLUMN IF NOT EXISTS review_fee_amount DECIMAL(12, 2);

ALTER TABLE public.patient_operations
  ADD COLUMN IF NOT EXISTS review_fee_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_review_statement BOOLEAN NOT NULL DEFAULT FALSE;

-- =============================================================================
-- HELPERS
-- =============================================================================
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.tenant_can_access(p_clinic_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin()
    OR (p_clinic_id IS NOT NULL AND p_clinic_id = public.get_my_clinic_id());
$$;

-- =============================================================================
-- WALLET STATS (source of truth for app)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_doctor_wallet_stats(p_doctor_id UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic_id UUID;
  v_earned NUMERIC;
  v_paid_out NUMERIC;
  v_pending NUMERIC;
  v_approved NUMERIC;
  v_balance NUMERIC;
BEGIN
  SELECT clinic_id INTO v_clinic_id FROM public.doctors WHERE id = p_doctor_id;
  IF v_clinic_id IS NULL THEN
    RETURN json_build_object('error', 'doctor_not_found');
  END IF;

  IF NOT public.tenant_can_access(v_clinic_id) THEN
    RAISE EXCEPTION 'access denied';
  END IF;

  SELECT COALESCE(SUM(doctor_share_amount), 0) INTO v_earned
  FROM public.patient_operations WHERE doctor_id = p_doctor_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid_out
  FROM public.doctor_withdrawals
  WHERE doctor_id = p_doctor_id AND status = 'paid';

  SELECT COALESCE(SUM(amount), 0) INTO v_pending
  FROM public.doctor_withdrawals
  WHERE doctor_id = p_doctor_id AND status = 'pending';

  SELECT COALESCE(SUM(amount), 0) INTO v_approved
  FROM public.doctor_withdrawals
  WHERE doctor_id = p_doctor_id AND status = 'approved';

  v_balance := GREATEST(0, v_earned - v_paid_out - v_pending - v_approved);

  RETURN json_build_object(
    'total_earnings', ROUND(v_earned, 2),
    'total_withdrawn', ROUND(v_paid_out, 2),
    'pending_amount', ROUND(v_pending, 2),
    'approved_amount', ROUND(v_approved, 2),
    'available_balance', ROUND(v_balance, 2)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_doctor_wallet_stats(UUID) TO authenticated;

-- Validate withdrawal amount on insert/update
CREATE OR REPLACE FUNCTION public.validate_withdrawal_amount()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stats JSON;
  v_available NUMERIC;
BEGIN
  IF NEW.status = 'rejected' THEN
    RETURN NEW;
  END IF;

  v_stats := public.get_doctor_wallet_stats(NEW.doctor_id);
  v_available := (v_stats->>'available_balance')::NUMERIC;

  -- For updates from pending, balance already reserved; allow if same row
  IF TG_OP = 'UPDATE' AND OLD.status IN ('pending', 'approved') AND NEW.status = 'paid' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status = 'paid' AND NEW.source = 'accountant_cash' THEN
    IF NEW.amount > v_available + 0.001 THEN
      RAISE EXCEPTION 'withdrawal_exceeds_balance';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    IF NEW.amount > v_available + 0.001 THEN
      RAISE EXCEPTION 'withdrawal_exceeds_balance';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_withdrawal ON public.doctor_withdrawals;
CREATE TRIGGER trg_validate_withdrawal
  BEFORE INSERT OR UPDATE ON public.doctor_withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.validate_withdrawal_amount();

-- Review fee on operations
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
  NEW.review_fee_amount := 0;
  IF NOT COALESCE(NEW.is_review_statement, FALSE) THEN
    RETURN NEW;
  END IF;

  SELECT review_fee_amount INTO v_type_fee
  FROM public.operation_types WHERE id = NEW.operation_type_id;

  IF v_type_fee IS NOT NULL AND v_type_fee > 0 THEN
    NEW.review_fee_amount := v_type_fee;
    RETURN NEW;
  END IF;

  SELECT review_fee_amount INTO v_clinic_fee
  FROM public.clinics WHERE id = NEW.clinic_id;

  IF EXISTS (
    SELECT 1 FROM public.clinics
    WHERE id = NEW.clinic_id AND review_fee_enabled = TRUE
  ) THEN
    NEW.review_fee_amount := COALESCE(v_clinic_fee, 0);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_review_fee ON public.patient_operations;
CREATE TRIGGER trg_apply_review_fee
  BEFORE INSERT OR UPDATE ON public.patient_operations
  FOR EACH ROW EXECUTE FUNCTION public.apply_review_fee();

-- Include review fee in total for share calculation
CREATE OR REPLACE FUNCTION public.calculate_operation_shares()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  doc_pct NUMERIC;
  mat_share NUMERIC;
  clinic_revenue NUMERIC;
  doc_gross NUMERIC;
BEGIN
  SELECT
    (d.percentage::TEXT)::NUMERIC / 100,
    (d.materials_share::TEXT)::NUMERIC / 100
  INTO doc_pct, mat_share
  FROM public.doctors d
  WHERE d.id = NEW.doctor_id;

  clinic_revenue := NEW.total_amount + COALESCE(NEW.review_fee_amount, 0);
  doc_gross := clinic_revenue * doc_pct;
  NEW.doctor_share_amount := doc_gross - (COALESCE(NEW.materials_cost, 0) * mat_share);
  NEW.clinic_share_amount := clinic_revenue - NEW.doctor_share_amount;

  RETURN NEW;
END;
$$;

-- =============================================================================
-- RLS: fix duplicate profile policy
-- =============================================================================
DROP POLICY IF EXISTS profiles_update_self ON public.profiles;
CREATE POLICY profiles_update_self ON public.profiles
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Accountant can record cash withdrawals for doctors
DROP POLICY IF EXISTS withdrawals_accountant_insert ON public.doctor_withdrawals;
CREATE POLICY withdrawals_accountant_insert ON public.doctor_withdrawals
  FOR INSERT
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
    AND source = 'accountant_cash'
    AND status = 'paid'
  );

-- Tenant access + super_admin (fixes null clinic_id platform owner)
DROP POLICY IF EXISTS withdrawals_select ON public.doctor_withdrawals;
CREATE POLICY withdrawals_select ON public.doctor_withdrawals
  FOR SELECT USING (public.tenant_can_access(clinic_id));

DROP POLICY IF EXISTS operations_all ON public.patient_operations;
CREATE POLICY operations_all ON public.patient_operations
  FOR ALL
  USING (
    public.tenant_can_access(clinic_id)
    AND (
      public.get_my_role() != 'doctor'
      OR doctor_id IN (
        SELECT id FROM public.doctors WHERE profile_id = auth.uid()
      )
    )
  )
  WITH CHECK (public.tenant_can_access(clinic_id));

DROP POLICY IF EXISTS patients_all ON public.patients;
CREATE POLICY patients_all ON public.patients
  FOR ALL
  USING (public.tenant_can_access(clinic_id))
  WITH CHECK (public.tenant_can_access(clinic_id));

DROP POLICY IF EXISTS doctors_select ON public.doctors;
CREATE POLICY doctors_select ON public.doctors
  FOR SELECT USING (public.tenant_can_access(clinic_id));

DROP POLICY IF EXISTS expenses_all ON public.expenses;
CREATE POLICY expenses_all ON public.expenses
  FOR ALL
  USING (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  )
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_operations_doctor_date
  ON public.patient_operations (doctor_id, operation_date DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_doctor_status
  ON public.doctor_withdrawals (doctor_id, status);
CREATE INDEX IF NOT EXISTS idx_profiles_username
  ON public.profiles (username) WHERE username IS NOT NULL;
