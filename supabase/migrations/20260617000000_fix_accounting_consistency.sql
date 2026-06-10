-- إصلاح محاسبي: ربح العيادة، اللوحة التنفيذية، محفظة الطبيب (trigger السحب)

-- حصة العيادة من كل دفعة (نموذج plan/payment حيث clinic_share_amount = 0)
CREATE OR REPLACE FUNCTION public.calc_clinic_operation_earned(
  p_doctor_id UUID,
  p_clinic_share_amount NUMERIC,
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
  v_case_clinic NUMERIC;
  v_case_final NUMERIC;
BEGIN
  v_share := COALESCE(p_clinic_share_amount, 0);
  IF v_share <> 0 THEN
    RETURN ROUND(v_share, 2);
  END IF;

  v_paid := COALESCE(p_paid_amount, 0);
  IF v_paid = 0 THEN
    RETURN 0;
  END IF;

  IF p_treatment_case_id IS NOT NULL THEN
    SELECT clinic_share_total, final_price
    INTO v_case_clinic, v_case_final
    FROM public.patient_treatment_cases
    WHERE id = p_treatment_case_id;

    IF COALESCE(v_case_final, 0) > 0 THEN
      RETURN ROUND(v_paid * (COALESCE(v_case_clinic, 0) / v_case_final), 2);
    END IF;
  END IF;

  RETURN ROUND(
    v_paid - public.calc_doctor_operation_earned(
      p_doctor_id,
      0,
      p_paid_amount,
      p_treatment_case_id
    ),
    2
  );
END;
$$;

-- محفظة الطبيب: أرباح + خصومات صرفيات/رواتب (يطابق computeWalletStats في التطبيق)
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
  v_expense_deductions NUMERIC;
  v_payroll_deductions NUMERIC;
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

  SELECT COALESCE(SUM(ABS(amount)), 0) INTO v_expense_deductions
  FROM public.transactions
  WHERE doctor_id = p_doctor_id
    AND type = 'doctor_expense_doctor'
    AND amount < 0;

  SELECT COALESCE(SUM(ABS(amount)), 0) INTO v_payroll_deductions
  FROM public.transactions
  WHERE doctor_id = p_doctor_id
    AND type = 'assistant_payroll_doctor'
    AND amount < 0;

  v_balance := v_earned - v_paid_out - v_approved - v_expense_deductions - v_payroll_deductions;
  v_limit := GREATEST(0, v_balance - v_pending);

  RETURN json_build_object(
    'total_earnings', ROUND(v_earned, 2),
    'total_withdrawn', ROUND(v_paid_out, 2),
    'pending_amount', ROUND(v_pending, 2),
    'approved_amount', ROUND(v_approved, 2),
    'expense_deductions', ROUND(v_expense_deductions, 2),
    'payroll_deductions', ROUND(v_payroll_deductions, 2),
    'available_balance', ROUND(v_balance, 2),
    'withdrawable_limit', ROUND(v_limit, 2)
  );
END;
$$;

-- اللوحة التنفيذية: حصص من الدفعات + صرفيات العيادة من الأطباء
CREATE OR REPLACE FUNCTION public.get_clinic_financial_snapshot(
  p_clinic_id UUID,
  p_from DATE DEFAULT DATE_TRUNC('month', CURRENT_DATE)::DATE,
  p_to   DATE DEFAULT CURRENT_DATE
)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_revenue          NUMERIC := 0;
  v_collected        NUMERIC := 0;
  v_debt             NUMERIC := 0;
  v_doctor_shares    NUMERIC := 0;
  v_clinic_shares    NUMERIC := 0;
  v_expenses         NUMERIC := 0;
  v_tx_clinic_exp    NUMERIC := 0;
  v_salaries_paid    NUMERIC := 0;
  v_review_fees      NUMERIC := 0;
  v_withdrawals_paid NUMERIC := 0;
  v_materials        NUMERIC := 0;
  v_net_profit       NUMERIC := 0;
  v_patient_count    INT := 0;
  v_new_patients     INT := 0;
  v_op_count         INT := 0;
  v_prev_revenue     NUMERIC := 0;
  v_prev_expenses    NUMERIC := 0;
  v_days             INT;
  v_prev_from        DATE;
  v_prev_to          DATE;
BEGIN
  IF NOT public.tenant_can_access(p_clinic_id) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  SELECT
    COALESCE(SUM(po.total_amount), 0),
    COALESCE(SUM(po.paid_amount), 0),
    COALESCE(SUM(po.remaining_debt), 0),
    COALESCE(SUM(po.materials_cost), 0),
    COUNT(*)
  INTO v_revenue, v_collected, v_debt, v_materials, v_op_count
  FROM public.patient_operations po
  WHERE po.clinic_id = p_clinic_id
    AND po.operation_date BETWEEN p_from AND p_to;

  SELECT COALESCE(SUM(
    public.calc_doctor_operation_earned(
      po.doctor_id,
      po.doctor_share_amount,
      po.paid_amount,
      po.treatment_case_id
    )
  ), 0) INTO v_doctor_shares
  FROM public.patient_operations po
  WHERE po.clinic_id = p_clinic_id
    AND po.operation_date BETWEEN p_from AND p_to;

  SELECT COALESCE(SUM(
    public.calc_clinic_operation_earned(
      po.doctor_id,
      po.clinic_share_amount,
      po.paid_amount,
      po.treatment_case_id
    )
  ), 0) INTO v_clinic_shares
  FROM public.patient_operations po
  WHERE po.clinic_id = p_clinic_id
    AND po.operation_date BETWEEN p_from AND p_to;

  SELECT COALESCE(SUM(po.review_fee_amount), 0) INTO v_review_fees
  FROM public.patient_operations po
  WHERE po.clinic_id = p_clinic_id
    AND po.operation_date BETWEEN p_from AND p_to
    AND COALESCE(po.review_fee_amount, 0) > 0;

  SELECT COALESCE(SUM(amount), 0) INTO v_expenses
  FROM public.expenses
  WHERE clinic_id = p_clinic_id
    AND expense_date BETWEEN p_from AND p_to;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'transactions'
  ) THEN
    SELECT COALESCE(SUM(ABS(amount)), 0) INTO v_tx_clinic_exp
    FROM public.transactions
    WHERE clinic_id = p_clinic_id
      AND type = 'doctor_expense_clinic'
      AND amount < 0
      AND transaction_date BETWEEN p_from AND p_to;
  END IF;

  v_expenses := v_expenses + v_tx_clinic_exp;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'salary_slips'
  ) THEN
    SELECT COALESCE(SUM(ss.net_payout), 0) INTO v_salaries_paid
    FROM public.salary_slips ss
    WHERE ss.clinic_id = p_clinic_id
      AND ss.status = 'paid'
      AND (
        (ss.paid_at IS NOT NULL AND ss.paid_at::DATE BETWEEN p_from AND p_to)
        OR (
          ss.month_year >= to_char(p_from, 'YYYY-MM')
          AND ss.month_year <= to_char(p_to, 'YYYY-MM')
        )
      );
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_withdrawals_paid
  FROM public.doctor_withdrawals
  WHERE clinic_id = p_clinic_id
    AND status = 'paid'
    AND processed_at::DATE BETWEEN p_from AND p_to;

  SELECT COUNT(DISTINCT patient_id) INTO v_patient_count
  FROM public.patient_operations
  WHERE clinic_id = p_clinic_id
    AND operation_date BETWEEN p_from AND p_to;

  SELECT COUNT(*) INTO v_new_patients
  FROM public.patients
  WHERE clinic_id = p_clinic_id
    AND created_at::DATE BETWEEN p_from AND p_to;

  v_net_profit := v_clinic_shares + v_review_fees - v_expenses - v_salaries_paid;

  v_days := (p_to - p_from);
  v_prev_to   := p_from - 1;
  v_prev_from := v_prev_to - v_days;

  SELECT COALESCE(SUM(total_amount), 0) INTO v_prev_revenue
  FROM public.patient_operations
  WHERE clinic_id = p_clinic_id
    AND operation_date BETWEEN v_prev_from AND v_prev_to;

  SELECT COALESCE(SUM(amount), 0) INTO v_prev_expenses
  FROM public.expenses
  WHERE clinic_id = p_clinic_id
    AND expense_date BETWEEN v_prev_from AND v_prev_to;

  RETURN json_build_object(
    'revenue',           ROUND(v_revenue, 2),
    'collected',         ROUND(v_collected, 2),
    'debt',              ROUND(v_debt, 2),
    'doctor_shares',     ROUND(v_doctor_shares, 2),
    'clinic_shares',     ROUND(v_clinic_shares, 2),
    'materials_cost',    ROUND(v_materials, 2),
    'expenses',          ROUND(v_expenses, 2),
    'salaries_paid',     ROUND(v_salaries_paid, 2),
    'review_fees',       ROUND(v_review_fees, 2),
    'withdrawals_paid',  ROUND(v_withdrawals_paid, 2),
    'net_profit',        ROUND(v_net_profit, 2),
    'operation_count',   v_op_count,
    'patient_count',     v_patient_count,
    'new_patients',      v_new_patients,
    'prev_revenue',      ROUND(v_prev_revenue, 2),
    'prev_expenses',     ROUND(v_prev_expenses, 2),
    'revenue_growth',    CASE WHEN v_prev_revenue = 0 THEN NULL
                              ELSE ROUND(((v_revenue - v_prev_revenue) / v_prev_revenue) * 100, 1) END,
    'period_from',       p_from,
    'period_to',         p_to
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.calc_clinic_operation_earned(UUID, NUMERIC, NUMERIC, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calc_clinic_operation_earned(UUID, NUMERIC, NUMERIC, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_doctor_wallet_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_doctor_wallet_stats(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_clinic_financial_snapshot(UUID, DATE, DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';
