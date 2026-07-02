-- إصلاح سباقات السحوبات المالية وانتقالات الحالة غير الآمنة
--
-- المشاكل المُصلَحة:
-- 1. فحص الرصيد والإدخال كانا خطوتين منفصلتين بدون قفل — طلبان متزامنان
--    (تبويبان، أو ضغط مزدوج) يقدران يمران كلاهما من نفس فحص الرصيد.
--    الحل: pg_advisory_xact_lock لكل طبيب يُحجز طوال المعاملة، فيسلسل كل
--    عمليات الإدخال/التحديث لنفس الطبيب.
-- 2. لا يوجد تحقق من الانتقالات الشرعية للحالة — سحب "مرفوض" كان يقدر
--    يتحول مباشرة لـ "مدفوع" بدون أي فحص رصيد (يسقط على RETURN NEW غير
--    المشروط بنهاية الدالة القديمة). الحل: قائمة انتقالات شرعية صريحة.
-- 3. دالة رصيد قاعدة البيانات (خط الدفاع الأخير) كانت لا تطرح خصومات
--    الرواتب/المصاريف التي يطرحها كود JS (computeWalletStats) — يعني
--    فحص قاعدة البيانات كان أضعف من فحص التطبيق. الحل: توحيد الصيغة.

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

  -- توحيد مع computeWalletStats بـ src/lib/services/doctor-wallet.ts —
  -- بدون هذا كان فحص قاعدة البيانات (خط الدفاع الأخير) أضعف من فحص التطبيق
  SELECT COALESCE(SUM(ABS(amount)), 0) INTO v_expense_deductions
  FROM public.transactions
  WHERE doctor_id = p_doctor_id AND type = 'doctor_expense_doctor' AND amount < 0;

  SELECT COALESCE(SUM(ABS(amount)), 0) INTO v_payroll_deductions
  FROM public.transactions
  WHERE doctor_id = p_doctor_id AND type = 'assistant_payroll_doctor' AND amount < 0;

  v_balance := GREATEST(
    0,
    v_earned - v_paid_out - v_approved - v_expense_deductions - v_payroll_deductions
  );
  v_limit := GREATEST(
    0,
    v_earned - v_paid_out - v_approved - v_pending - v_expense_deductions - v_payroll_deductions
  );

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

CREATE OR REPLACE FUNCTION public.validate_withdrawal_amount()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stats JSON;
  v_limit NUMERIC;
  v_doctor_id UUID;
BEGIN
  v_doctor_id := COALESCE(NEW.doctor_id, OLD.doctor_id);

  -- قفل معاملة لكل طبيب — يسلسل كل إدخال/تحديث لسحوبات نفس الطبيب حتى
  -- commit، فيمنع طلبين متزامنين من المرور كليهما من نفس فحص الرصيد.
  PERFORM pg_advisory_xact_lock(hashtext(v_doctor_id::text));

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'rejected' THEN
      RETURN NEW;
    END IF;

    IF NEW.status = 'pending' THEN
      v_stats := public.get_doctor_wallet_stats(NEW.doctor_id);
      v_limit := COALESCE((v_stats->>'withdrawable_limit')::NUMERIC, 0);
      IF NEW.amount > v_limit + 0.001 THEN
        RAISE EXCEPTION 'withdrawal_exceeds_balance';
      END IF;
      RETURN NEW;
    END IF;

    IF NEW.status = 'paid' AND NEW.source = 'accountant_cash' THEN
      v_stats := public.get_doctor_wallet_stats(NEW.doctor_id);
      v_limit := COALESCE((v_stats->>'withdrawable_limit')::NUMERIC, 0);
      IF NEW.amount > v_limit + 0.001 THEN
        RAISE EXCEPTION 'withdrawal_exceeds_balance';
      END IF;
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'invalid_withdrawal_insert_status';
  END IF;

  -- TG_OP = 'UPDATE' — المبلغ والطبيب لا يتغيران بعد الإنشاء إطلاقاً
  IF NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
     OR NEW.amount IS DISTINCT FROM OLD.amount THEN
    RAISE EXCEPTION 'withdrawal_amount_or_doctor_immutable';
  END IF;

  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- قائمة الانتقالات الشرعية الوحيدة — أي انتقال غير مذكور هنا (مثل
  -- rejected → paid أو paid → أي حالة) يُرفض صراحة بدل السقوط الصامت
  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'paid', 'rejected') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'approved' AND NEW.status IN ('paid', 'rejected') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'illegal_withdrawal_status_transition';
END;
$$;

-- الـ trigger نفسه بدون تغيير (BEFORE INSERT OR UPDATE ... FOR EACH ROW)
-- تم تعريفه مسبقاً بـ 20260525000000_financial_engine_and_rls.sql

GRANT EXECUTE ON FUNCTION public.get_doctor_wallet_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_doctor_wallet_stats(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
