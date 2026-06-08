-- Wallet: sum payment-based doctor share (trigger stores 0 on plan/payment rows)

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
  v_pct NUMERIC;
BEGIN
  v_share := COALESCE(p_doctor_share_amount, 0);
  IF v_share <> 0 THEN
    RETURN ROUND(v_share, 2);
  END IF;

  v_paid := COALESCE(p_paid_amount, 0);
  IF v_paid = 0 THEN
    RETURN 0;
  END IF;

  IF p_treatment_case_id IS NOT NULL THEN
    SELECT doctor_share_total, final_price
    INTO v_case_doc, v_case_final
    FROM public.patient_treatment_cases
    WHERE id = p_treatment_case_id;

    IF COALESCE(v_case_final, 0) > 0 THEN
      RETURN ROUND(v_paid * (COALESCE(v_case_doc, 0) / v_case_final), 2);
    END IF;
  END IF;

  SELECT (d.percentage::TEXT)::NUMERIC / 100
  INTO v_pct
  FROM public.doctors d
  WHERE d.id = p_doctor_id;

  RETURN ROUND(v_paid * COALESCE(v_pct, 0.5), 2);
END;
$$;

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

  SELECT COALESCE(SUM(
    public.calc_doctor_operation_earned(
      po.doctor_id,
      po.doctor_share_amount,
      po.paid_amount,
      po.treatment_case_id
    )
  ), 0) INTO v_earned
  FROM public.patient_operations po
  WHERE po.doctor_id = p_doctor_id;

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

GRANT EXECUTE ON FUNCTION public.calc_doctor_operation_earned(UUID, NUMERIC, NUMERIC, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calc_doctor_operation_earned(UUID, NUMERIC, NUMERIC, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_doctor_wallet_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_doctor_wallet_stats(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
