-- إصلاح خصم الرواتب في اللوحة التنفيذية — paid_net_payout بدل net_payout (أجر يومي)
-- net_profit في RPC بدون رواتب — التطبيق يخصم عبر /api/executive/supplement

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
  v_has_paid_col     BOOLEAN := FALSE;
BEGIN
  IF NOT public.tenant_can_access(p_clinic_id) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'salary_slips'
      AND column_name = 'paid_net_payout'
  ) INTO v_has_paid_col;

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
    AND expense_date BETWEEN p_from AND p_to
    AND COALESCE(expense_kind, 'general') <> 'doctor_salary';

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
    IF v_has_paid_col THEN
      SELECT COALESCE(SUM(
        CASE
          WHEN COALESCE(ss.paid_net_payout, 0) > 0 THEN ss.paid_net_payout
          WHEN ss.status = 'paid' THEN ss.net_payout
          ELSE 0
        END
      ), 0) INTO v_salaries_paid
      FROM public.salary_slips ss
      WHERE ss.clinic_id = p_clinic_id
        AND (
          ss.status = 'paid'
          OR COALESCE(ss.paid_net_payout, 0) > 0
        )
        AND (
          (ss.paid_at IS NOT NULL AND ss.paid_at::DATE BETWEEN p_from AND p_to)
          OR (
            ss.paid_at IS NULL
            AND ss.status = 'paid'
            AND ss.month_year >= to_char(p_from, 'YYYY-MM')
            AND ss.month_year <= to_char(p_to, 'YYYY-MM')
          )
        );
    ELSE
      SELECT COALESCE(SUM(ss.net_payout), 0) INTO v_salaries_paid
      FROM public.salary_slips ss
      WHERE ss.clinic_id = p_clinic_id
        AND ss.status = 'paid'
        AND (
          (ss.paid_at IS NOT NULL AND ss.paid_at::DATE BETWEEN p_from AND p_to)
          OR (
            ss.paid_at IS NULL
            AND ss.status = 'paid'
            AND ss.month_year >= to_char(p_from, 'YYYY-MM')
            AND ss.month_year <= to_char(p_to, 'YYYY-MM')
          )
        );
    END IF;
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

  -- الرواتب تُخصم في التطبيق (mergeExecutiveDashboardMetrics) — تجنّب الازدواجية
  v_net_profit := v_clinic_shares + v_review_fees - v_expenses;

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
    AND expense_date BETWEEN v_prev_from AND v_prev_to
    AND COALESCE(expense_kind, 'general') <> 'doctor_salary';

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

GRANT EXECUTE ON FUNCTION public.get_clinic_financial_snapshot(UUID, DATE, DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';
