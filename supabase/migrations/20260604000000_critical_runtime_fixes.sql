-- Critical runtime fixes: withdrawals (service role + triggers), patient_queue clinic_id
-- Safe to re-run in Supabase SQL Editor

-- =============================================================================
-- 1) Wallet stats — skip tenant check when no JWT (triggers / service_role)
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
  v_limit NUMERIC;
BEGIN
  SELECT clinic_id INTO v_clinic_id FROM public.doctors WHERE id = p_doctor_id;
  IF v_clinic_id IS NULL THEN
    RETURN json_build_object('error', 'doctor_not_found');
  END IF;

  IF auth.uid() IS NOT NULL AND NOT public.tenant_can_access(v_clinic_id) THEN
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

  v_balance := GREATEST(0, v_earned - v_paid_out - v_approved);
  v_limit := GREATEST(0, v_earned - v_paid_out - v_approved - v_pending);

  RETURN json_build_object(
    'total_earnings', ROUND(v_earned, 2),
    'total_withdrawn', ROUND(v_paid_out, 2),
    'pending_amount', ROUND(v_pending, 2),
    'approved_amount', ROUND(v_approved, 2),
    'available_balance', ROUND(v_balance, 2),
    'withdrawable_limit', ROUND(v_limit, 2)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_doctor_wallet_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_doctor_wallet_stats(UUID) TO service_role;

-- =============================================================================
-- 2) patient_queue — auto clinic_id (like other tenant tables)
-- =============================================================================
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'patient_queue'
  ) THEN
    DROP TRIGGER IF EXISTS trg_patient_queue_clinic ON public.patient_queue;
    CREATE TRIGGER trg_patient_queue_clinic
      BEFORE INSERT ON public.patient_queue
      FOR EACH ROW EXECUTE FUNCTION public.set_clinic_id_from_profile();
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
