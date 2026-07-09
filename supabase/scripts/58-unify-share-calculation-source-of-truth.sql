-- =============================================================================
-- توحيد مصدر الحقيقة لحصص الطبيب/العيادة — يمنع تكرار انحراف الأرصدة
-- =============================================================================
-- المشكلة (منذ تعديلات 6-10 تموز):
--   1) trigger calculate_operation_shares كان يستبدل حصة الطبيب بنسبة الحالة
--      (case_doc/case_final) القديمة فقط في حالة تحقق شرط ضيّق (50/50 بالضبط)،
--      فإذا كانت نسبة الحالة منحرفة أصلاً (مثل 67.5% بدل 40%) يبقى الانحراف.
--   2) calc_doctor_operation_earned / calc_clinic_operation_earned كانتا تعيدان
--      حساب الحصة من نسبة الحالة أو نسبة الطبيب الحالية إذا كانت القيمة
--      المخزّنة = صفر بالضبط — لكن صفر ممكن يكون صحيحاً 100% (كشفية فقط، أو
--      طبيب راتب)، فتُنتج حصة خاطئة رغم أن trigger جمّد الصفر الصحيح.
--   3) get_clinic_financial_snapshot كانت تجمع مبلغ الكشفية مرتين: مرة ضمن
--      clinic_share_amount (لأنه أصلاً جزء منه بعد إصلاحات تموز) ومرة إضافية
--      بعمود review_fees منفصل — يرفع ربح العيادة صناعياً.
--
-- الحل: القيمة المجمّدة وقت الدفع (doctor_share_amount / clinic_share_amount)
-- هي المصدر الوحيد للحقيقة في كل مكان — بدون أي إعادة حساب لاحقة بنسبة "حالية"
-- تختلف حسب زمن القراءة. الـ trigger يحسبها مرة واحدة بنسبة الطبيب الحالية
-- (من ملفه) لحظة كل دفعة، وكل القراءات (تطبيق، تقارير، RPC) تثق بها فقط.
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) trigger calculate_operation_shares — دفعات 'payment' تعتمد نسبة الطبيب
--    الحالية مباشرة على مبلغ العلاج (بدون كشفية)، بلا اعتماد على نسب حالات
--    قديمة قد تكون منحرفة. باقي الفروع (refund / plan) بلا تغيير.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.calculate_operation_shares()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agreed         NUMERIC;
  v_total_paid     NUMERIC;
  v_locked         BOOLEAN;
  v_doc_pct        NUMERIC := 0.5;
  v_mat_share      NUMERIC := 0;
  v_payment_type   TEXT := 'percentage';
  v_doc_gross      NUMERIC;
  v_doc_share      NUMERIC;
  v_clinic_share   NUMERIC;
  v_is_plan        BOOLEAN;
  v_review_fee     NUMERIC;
  v_plan_total     NUMERIC;
  v_case_id        UUID;
  v_case_doc       NUMERIC;
  v_case_clinic    NUMERIC;
  v_case_paid      NUMERIC;
  v_new_paid       NUMERIC;
  v_paid           NUMERIC;
  v_treatment_paid NUMERIC;
BEGIN
  SELECT agreed_total, total_paid, financial_locked
  INTO v_agreed, v_total_paid, v_locked
  FROM public.patients
  WHERE id = NEW.patient_id;

  v_agreed := COALESCE(v_agreed, 0);
  v_total_paid := COALESCE(v_total_paid, 0);
  v_review_fee := COALESCE(NEW.review_fee_amount, 0);

  -- ── إرجاع ─────────────────────────────────────────────────────────────
  IF NEW.session_kind = 'refund' THEN
    NEW.total_amount := 0;
    NEW.materials_cost := COALESCE(NEW.materials_cost, 0);
    NEW.doctor_share_amount := COALESCE(NEW.doctor_share_amount, 0);
    NEW.clinic_share_amount := COALESCE(NEW.clinic_share_amount, 0);

    IF NEW.treatment_case_id IS NOT NULL THEN
      v_case_id := NEW.treatment_case_id;
      SELECT doctor_share_total, clinic_share_total, total_paid
      INTO v_case_doc, v_case_clinic, v_case_paid
      FROM public.patient_treatment_cases
      WHERE id = v_case_id;

      IF FOUND THEN
        v_new_paid := GREATEST(0, ROUND(v_case_paid + COALESCE(NEW.paid_amount, 0), 2));
        UPDATE public.patient_treatment_cases
        SET
          doctor_share_total = GREATEST(0, ROUND(v_case_doc - ABS(COALESCE(NEW.doctor_share_amount, 0)), 2)),
          clinic_share_total = GREATEST(0, ROUND(v_case_clinic - ABS(COALESCE(NEW.clinic_share_amount, 0)), 2)),
          total_paid = v_new_paid,
          status = CASE
            WHEN v_new_paid >= final_price AND final_price > 0 THEN 'completed'
            ELSE 'active'
          END,
          updated_at = now()
        WHERE id = v_case_id;
      END IF;
    ELSIF v_agreed > 0 THEN
      v_new_paid := GREATEST(0, ROUND(v_total_paid + COALESCE(NEW.paid_amount, 0), 2));
      UPDATE public.patients
      SET
        total_paid = v_new_paid,
        doctor_share_total = GREATEST(
          0,
          ROUND(COALESCE(doctor_share_total, 0) - ABS(COALESCE(NEW.doctor_share_amount, 0)), 2)
        ),
        clinic_share_total = GREATEST(
          0,
          ROUND(COALESCE(clinic_share_total, 0) - ABS(COALESCE(NEW.clinic_share_amount, 0)), 2)
        )
      WHERE id = NEW.patient_id;

      v_total_paid := v_new_paid;
      NEW.remaining_debt := GREATEST(0, v_agreed - v_total_paid);

      IF v_total_paid < v_agreed THEN
        UPDATE public.patients SET treatment_status = 'active' WHERE id = NEW.patient_id;
      END IF;
    ELSE
      NEW.remaining_debt := GREATEST(0, COALESCE(NEW.total_amount, 0) - COALESCE(NEW.paid_amount, 0));
    END IF;

    RETURN NEW;
  END IF;

  -- ── إنشاء خطة علاج (أول دفعة تحدّد السعر الكلي) ─────────────────────────
  v_is_plan := (
    NEW.session_kind = 'plan'
    OR (COALESCE(NEW.total_amount, 0) > 0 AND NOT COALESCE(v_locked, FALSE))
  );

  IF v_is_plan AND (COALESCE(NEW.total_amount, 0) > 0 OR v_review_fee > 0) THEN
    v_plan_total := COALESCE(NEW.total_amount, 0) + v_review_fee;

    SELECT
      COALESCE(NULLIF(d.payment_type, ''), 'percentage'),
      (d.percentage::TEXT)::NUMERIC / 100,
      (d.materials_share::TEXT)::NUMERIC / 100
    INTO v_payment_type, v_doc_pct, v_mat_share
    FROM public.doctors d
    WHERE d.id = NEW.doctor_id;

    IF COALESCE(v_payment_type, 'percentage') = 'salary' THEN
      v_doc_share := 0;
      v_clinic_share := v_plan_total;
    ELSE
      v_doc_gross := COALESCE(NEW.total_amount, 0) * v_doc_pct;
      v_doc_share := v_doc_gross - (COALESCE(NEW.materials_cost, 0) * v_mat_share);
      v_clinic_share := (COALESCE(NEW.total_amount, 0) - v_doc_share) + v_review_fee;
    END IF;

    UPDATE public.patients
    SET
      agreed_total = v_plan_total,
      doctor_share_total = ROUND(v_doc_share::NUMERIC, 2),
      clinic_share_total = ROUND(v_clinic_share::NUMERIC, 2),
      previous_total = v_plan_total,
      financial_locked = TRUE,
      total_paid = total_paid + COALESCE(NEW.paid_amount, 0)
    WHERE id = NEW.patient_id;

    SELECT total_paid INTO v_total_paid FROM public.patients WHERE id = NEW.patient_id;

    NEW.session_kind := 'plan';
    IF COALESCE(v_payment_type, 'percentage') = 'salary' THEN
      NEW.doctor_share_amount := 0;
      NEW.clinic_share_amount := CASE
        WHEN COALESCE(NEW.paid_amount, 0) > 0 THEN ROUND(COALESCE(NEW.paid_amount, 0), 2)
        ELSE 0
      END;
    ELSIF COALESCE(NEW.paid_amount, 0) > 0 AND v_plan_total > 0 THEN
      NEW.doctor_share_amount := ROUND(NEW.paid_amount * v_doc_share / v_plan_total, 2);
      NEW.clinic_share_amount := ROUND(NEW.paid_amount * v_clinic_share / v_plan_total, 2);
    ELSE
      NEW.doctor_share_amount := 0;
      NEW.clinic_share_amount := 0;
    END IF;
    NEW.remaining_debt := GREATEST(0, v_plan_total - v_total_paid);

    RETURN NEW;
  END IF;

  -- ── دفعة متابعة (session_kind = 'payment') ──────────────────────────────
  -- نسبة الطبيب الحالية من ملفه مباشرة على مبلغ العلاج (المدفوع − الكشفية إن
  -- وُجدت) — بدون أي اعتماد على نسبة حالة/خطة مخزّنة قديمة قد تكون منحرفة.
  NEW.session_kind := 'payment';
  NEW.total_amount := 0;
  NEW.materials_cost := COALESCE(NEW.materials_cost, 0);
  v_paid := COALESCE(NEW.paid_amount, 0);

  SELECT
    COALESCE(NULLIF(d.payment_type, ''), 'percentage'),
    (d.percentage::TEXT)::NUMERIC / 100,
    (d.materials_share::TEXT)::NUMERIC / 100
  INTO v_payment_type, v_doc_pct, v_mat_share
  FROM public.doctors d
  WHERE d.id = NEW.doctor_id;

  IF COALESCE(v_payment_type, 'percentage') = 'salary' THEN
    NEW.doctor_share_amount := 0;
    NEW.clinic_share_amount := ROUND(v_paid, 2);
  ELSIF v_paid > 0 AND (
    (v_review_fee > 0 AND v_paid <= v_review_fee + 0.01)
    OR (
      COALESCE(NEW.is_review_statement, FALSE)
      AND v_review_fee <= 0
      AND NEW.treatment_case_id IS NULL
      AND COALESCE(v_agreed, 0) <= 0
    )
  ) THEN
    -- كشفية فقط — 100% للعيادة، لا شيء للطبيب
    NEW.doctor_share_amount := 0;
    NEW.clinic_share_amount := ROUND(v_paid, 2);
  ELSIF v_paid > 0 THEN
    IF v_review_fee > 0 AND v_paid > v_review_fee THEN
      v_treatment_paid := v_paid - v_review_fee;
    ELSE
      v_treatment_paid := v_paid;
    END IF;

    NEW.doctor_share_amount := ROUND(
      GREATEST(0, v_treatment_paid * COALESCE(v_doc_pct, 0.5) - NEW.materials_cost * v_mat_share),
      2
    );
    NEW.clinic_share_amount := ROUND(v_paid - NEW.doctor_share_amount, 2);
  ELSE
    NEW.doctor_share_amount := 0;
    NEW.clinic_share_amount := 0;
  END IF;

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

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) calc_doctor_operation_earned / calc_clinic_operation_earned — الاعتماد
--    المطلق على القيمة المجمّدة (بلا احتياطي يفسد الصفر الصحيح). الـ trigger
--    أعلاه يحسب القيمة لكل صف INSERT/UPDATE، فلا حاجة لأي إعادة حساب هنا.
-- ═══════════════════════════════════════════════════════════════════════════
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
BEGIN
  -- معاملات p_paid_amount / p_treatment_case_id محفوظة للتوافق مع الاستدعاءات
  -- الحالية فقط — لا تُستخدم؛ القيمة المجمّدة وحدها مصدر الحقيقة.
  RETURN ROUND(COALESCE(p_doctor_share_amount, 0), 2);
END;
$$;

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
BEGIN
  RETURN ROUND(COALESCE(p_clinic_share_amount, 0), 2);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) get_clinic_financial_snapshot — إزالة مضاعفة الكشفية من صافي الربح.
--    clinic_share_amount أصلاً يشمل الكشفية (بعد إصلاحات تموز)، فجمعها ثانية
--    ضمن v_review_fees داخل net_profit كان يرفع ربح العيادة صناعياً.
--    عمود review_fees يبقى في الناتج كبند تفصيلي إعلامي فقط (لا يُضاف للربح).
-- ═══════════════════════════════════════════════════════════════════════════
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
    SELECT COALESCE(SUM(ABS(amount)), 0) INTO v_tx_clinic_exp
    FROM public.transactions
    WHERE clinic_id = p_clinic_id
      AND type = 'doctor_expense_clinic'
      AND amount < 0
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

GRANT EXECUTE ON FUNCTION public.calc_doctor_operation_earned(UUID, NUMERIC, NUMERIC, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calc_doctor_operation_earned(UUID, NUMERIC, NUMERIC, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.calc_clinic_operation_earned(UUID, NUMERIC, NUMERIC, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calc_clinic_operation_earned(UUID, NUMERIC, NUMERIC, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_clinic_financial_snapshot(UUID, DATE, DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';
