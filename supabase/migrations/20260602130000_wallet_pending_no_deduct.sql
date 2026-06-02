-- Wallet: pending requests no longer reduce displayed balance (only approve/pay do)

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

  -- Display balance: paid + approved only (pending does NOT reduce balance)
  v_balance := GREATEST(0, v_earned - v_paid_out - v_approved);
  -- Max for new request: also reserve existing pending requests
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

CREATE OR REPLACE FUNCTION public.validate_withdrawal_amount()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stats JSON;
  v_limit NUMERIC;
BEGIN
  IF NEW.status = 'rejected' THEN
    RETURN NEW;
  END IF;

  v_stats := public.get_doctor_wallet_stats(NEW.doctor_id);
  v_limit := COALESCE((v_stats->>'withdrawable_limit')::NUMERIC, 0);

  IF TG_OP = 'UPDATE' AND OLD.status IN ('pending', 'approved') AND NEW.status = 'paid' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'approved' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status = 'paid' AND NEW.source = 'accountant_cash' THEN
    IF NEW.amount > v_limit + 0.001 THEN
      RAISE EXCEPTION 'withdrawal_exceeds_balance';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    IF NEW.amount > v_limit + 0.001 THEN
      RAISE EXCEPTION 'withdrawal_exceeds_balance';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
