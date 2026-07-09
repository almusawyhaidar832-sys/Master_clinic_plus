-- =============================================================================
-- إصلاح صافي الخصومات (مصروفات الطبيب / أجور المساعدين / صرفيات العيادة)
-- =============================================================================
-- المشكلة: v_expense_deductions و v_payroll_deductions (في get_doctor_wallet_stats)
-- وكذلك v_tx_clinic_exp (في get_clinic_financial_snapshot) كانت تجمع القيمة المطلقة
-- للحركات السالبة فقط (WHERE amount < 0)، وتتجاهل كلياً أي حركة "تصحيح" موجبة من
-- نفس النوع (مثل استرجاع جزء من خصم سابق بعد حذف/تعديل يوم عمل مساعد).
--
-- مثال حقيقي (دكتور حارث، مساعدة يسرى):
--   -10000 (صرف) ، -15000 (صرف) ، +7500 (تصحيح: حذف/تعديل يوم 2026-07-05) ، -7500 (صرف)
--   الصافي الصحيح = -(-10000-15000+7500-7500) = 25000
--   الحساب القديم (يتجاهل +7500) = 10000+15000+7500 = 32500  ← خطأ بمقدار 7500
--   والموبايل كان أسوأ: يضيف +7500 كخصم إضافي بدل طرحه = 40000 ← خطأ بمقدار 15000
--
-- الحل: نجمع كل حركات النوع (بلا فلترة على العلامة)، ثم نأخذ سالب الصافي
-- (GREATEST(0, -SUM(amount))) — هذا يطرح التصحيحات الموجبة تلقائياً من الخصم الكلي.
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
  v_expense_deductions NUMERIC;
  v_payroll_deductions NUMERIC;
  v_balance_credits NUMERIC;
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

  -- صافي كل حركات النوع (خصومات سالبة + تصحيحات موجبة) — لا نتجاهل التصحيحات
  SELECT GREATEST(0, -COALESCE(SUM(amount), 0)) INTO v_expense_deductions
  FROM public.transactions
  WHERE doctor_id = p_doctor_id AND type = 'doctor_expense_doctor';

  SELECT GREATEST(0, -COALESCE(SUM(amount), 0)) INTO v_payroll_deductions
  FROM public.transactions
  WHERE doctor_id = p_doctor_id AND type = 'assistant_payroll_doctor';

  SELECT COALESCE(SUM(amount), 0) INTO v_balance_credits
  FROM public.transactions
  WHERE doctor_id = p_doctor_id
    AND type = 'balance_topup_doctor'
    AND amount > 0;

  v_balance := v_earned - v_paid_out - v_approved - v_expense_deductions - v_payroll_deductions + v_balance_credits;
  v_limit := v_earned - v_paid_out - v_approved - v_pending - v_expense_deductions - v_payroll_deductions + v_balance_credits;

  RETURN json_build_object(
    'total_earnings', ROUND(v_earned, 2),
    'total_withdrawn', ROUND(v_paid_out, 2),
    'pending_amount', ROUND(v_pending, 2),
    'approved_amount', ROUND(v_approved, 2),
    'expense_deductions', ROUND(v_expense_deductions, 2),
    'payroll_deductions', ROUND(v_payroll_deductions, 2),
    'balance_credits', ROUND(v_balance_credits, 2),
    'available_balance', ROUND(v_balance, 2),
    'withdrawable_limit', ROUND(GREATEST(0, v_limit), 2)
  );
END;
$$;

-- نفس الإصلاح لـ v_tx_clinic_exp (حصة العيادة من صرفيات الطبيب) داخل
-- get_clinic_financial_snapshot — بلا فلترة amount < 0، فقط صافي موقّع.
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
  v_balance_topups   NUMERIC := 0;
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
    -- صافي موقّع (لا فلترة amount < 0) — يطرح تصحيحات صرفيات العيادة الموجبة تلقائياً
    SELECT GREATEST(0, -COALESCE(SUM(amount), 0)) INTO v_tx_clinic_exp
    FROM public.transactions
    WHERE clinic_id = p_clinic_id
      AND type = 'doctor_expense_clinic'
      AND transaction_date BETWEEN p_from AND p_to;

    SELECT COALESCE(SUM(amount), 0) INTO v_balance_topups
    FROM public.transactions
    WHERE clinic_id = p_clinic_id
      AND type = 'balance_topup_clinic'
      AND amount > 0
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

  -- v_clinic_shares يشمل الكشفية أصلاً (clinic_share_amount المجمّدة) —
  -- v_review_fees يبقى بند تفصيلي فقط، بلا إضافة ثانية لصافي الربح
  v_net_profit := v_clinic_shares - v_expenses + v_balance_topups;

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
    'balance_topups',    ROUND(v_balance_topups, 2),
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

GRANT EXECUTE ON FUNCTION public.get_doctor_wallet_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_doctor_wallet_stats(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_clinic_financial_snapshot(UUID, DATE, DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';
