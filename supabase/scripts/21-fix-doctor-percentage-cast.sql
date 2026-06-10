-- إصلاح: cannot cast type doctor_percentage to numeric
-- السبب: سكربت 19 استخدم percentage::NUMERIC — الصحيح (percentage::TEXT)::NUMERIC
-- شغّله في Supabase SQL Editor بعد ظهور خطأ اللوحة التنفيذية
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

  WITH scoped_ops AS (
    SELECT
      po.total_amount,
      po.paid_amount,
      po.remaining_debt,
      po.materials_cost,
      po.review_fee_amount,
      po.patient_id,
      CASE
        WHEN COALESCE(po.doctor_share_amount, 0) <> 0
          THEN ROUND(po.doctor_share_amount, 2)
        WHEN COALESCE(po.paid_amount, 0) = 0 THEN 0::NUMERIC
        WHEN COALESCE(ptc.final_price, 0) > 0
             AND COALESCE(ptc.doctor_share_total, 0) > 0
          THEN ROUND(po.paid_amount * (ptc.doctor_share_total / ptc.final_price), 2)
        ELSE ROUND(
          po.paid_amount * (COALESCE((doc.percentage::TEXT)::NUMERIC, 50) / 100),
          2
        )
      END AS doctor_earned,
      CASE
        WHEN COALESCE(po.clinic_share_amount, 0) <> 0
          THEN ROUND(po.clinic_share_amount, 2)
        WHEN COALESCE(po.paid_amount, 0) = 0 THEN 0::NUMERIC
        WHEN COALESCE(ptc.final_price, 0) > 0
          THEN ROUND(
            po.paid_amount * (COALESCE(ptc.clinic_share_total, 0) / ptc.final_price),
            2
          )
        ELSE ROUND(
          po.paid_amount - (
            CASE
              WHEN COALESCE(po.doctor_share_amount, 0) <> 0
                THEN ROUND(po.doctor_share_amount, 2)
              WHEN COALESCE(po.paid_amount, 0) = 0 THEN 0::NUMERIC
              WHEN COALESCE(ptc.final_price, 0) > 0
                   AND COALESCE(ptc.doctor_share_total, 0) > 0
                THEN ROUND(
                  po.paid_amount * (ptc.doctor_share_total / ptc.final_price),
                  2
                )
              ELSE ROUND(
                po.paid_amount * (COALESCE((doc.percentage::TEXT)::NUMERIC, 50) / 100),
                2
              )
            END
          ),
          2
        )
      END AS clinic_earned
    FROM public.patient_operations po
    LEFT JOIN public.patient_treatment_cases ptc
      ON ptc.id = po.treatment_case_id
    LEFT JOIN public.doctors doc
      ON doc.id = po.doctor_id
    WHERE po.clinic_id = p_clinic_id
      AND po.operation_date BETWEEN p_from AND p_to
  )
  SELECT
    COALESCE(SUM(total_amount), 0),
    COALESCE(SUM(paid_amount), 0),
    COALESCE(SUM(remaining_debt), 0),
    COALESCE(SUM(materials_cost), 0),
    COUNT(*)::INT,
    COALESCE(SUM(doctor_earned), 0),
    COALESCE(SUM(clinic_earned), 0),
    COALESCE(
      SUM(
        CASE
          WHEN COALESCE(review_fee_amount, 0) > 0 THEN review_fee_amount
          ELSE 0
        END
      ),
      0
    ),
    COUNT(DISTINCT patient_id)::INT
  INTO
    v_revenue,
    v_collected,
    v_debt,
    v_materials,
    v_op_count,
    v_doctor_shares,
    v_clinic_shares,
    v_review_fees,
    v_patient_count
  FROM scoped_ops;

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

-- ظ…ط­ظپط¸ط© ط§ظ„ط·ط¨ظٹط¨: JOIN ظˆط§ط­ط¯ ط¨ط¯ظ„ calc ظ„ظƒظ„ طµظپ
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
    CASE
      WHEN COALESCE(po.doctor_share_amount, 0) <> 0
        THEN ROUND(po.doctor_share_amount, 2)
      WHEN COALESCE(po.paid_amount, 0) = 0 THEN 0::NUMERIC
      WHEN COALESCE(ptc.final_price, 0) > 0
           AND COALESCE(ptc.doctor_share_total, 0) > 0
        THEN ROUND(po.paid_amount * (ptc.doctor_share_total / ptc.final_price), 2)
      ELSE ROUND(
                po.paid_amount * (COALESCE((doc.percentage::TEXT)::NUMERIC, 50) / 100),
        2
      )
    END
  ), 0) INTO v_earned
  FROM public.patient_operations po
  LEFT JOIN public.patient_treatment_cases ptc ON ptc.id = po.treatment_case_id
  LEFT JOIN public.doctors doc ON doc.id = po.doctor_id
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

GRANT EXECUTE ON FUNCTION public.get_clinic_financial_snapshot(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_doctor_wallet_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_doctor_wallet_stats(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
