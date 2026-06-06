-- إدارة المرتجعات: سجل مستقل مرتبط بالجلسة + قيد محاسبي جديد (لا تعديل على الجلسات القديمة)

CREATE TABLE IF NOT EXISTS public.session_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.patient_operations(id) ON DELETE RESTRICT,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  treatment_case_id UUID REFERENCES public.patient_treatment_cases(id) ON DELETE SET NULL,
  amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  doctor_share_deduction DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (doctor_share_deduction >= 0),
  clinic_share_deduction DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (clinic_share_deduction >= 0),
  reason TEXT NOT NULL CHECK (char_length(trim(reason)) > 0),
  accounting_operation_id UUID REFERENCES public.patient_operations(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_refunds_clinic_created
  ON public.session_refunds (clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_refunds_session
  ON public.session_refunds (session_id);

COMMENT ON TABLE public.session_refunds IS
  'سجل المرتجعات — قيد محاسبي جديد مرتبط بجلسة دون تعديل سجل الجلسة الأصلي';

-- السماح بنوع جلسة «refund» للقيود المحاسبية الجديدة
ALTER TABLE public.patient_operations
  DROP CONSTRAINT IF EXISTS patient_operations_session_kind_check;

ALTER TABLE public.patient_operations
  ADD CONSTRAINT patient_operations_session_kind_check
  CHECK (session_kind IN ('plan', 'payment', 'discount', 'refund'));

-- معالجة قيود الإرجاع في محرك الحصص
CREATE OR REPLACE FUNCTION public.calculate_operation_shares()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agreed        NUMERIC;
  v_total_paid    NUMERIC;
  v_locked        BOOLEAN;
  v_doc_pct       NUMERIC := 0.5;
  v_mat_share     NUMERIC := 0;
  v_doc_gross     NUMERIC;
  v_doc_share     NUMERIC;
  v_clinic_share  NUMERIC;
  v_is_plan       BOOLEAN;
  v_review_fee    NUMERIC;
  v_plan_total    NUMERIC;
  v_case_id       UUID;
  v_case_doc      NUMERIC;
  v_case_clinic   NUMERIC;
  v_case_paid     NUMERIC;
  v_new_paid      NUMERIC;
BEGIN
  SELECT agreed_total, total_paid, financial_locked
  INTO v_agreed, v_total_paid, v_locked
  FROM public.patients
  WHERE id = NEW.patient_id;

  v_agreed := COALESCE(v_agreed, 0);
  v_total_paid := COALESCE(v_total_paid, 0);
  v_review_fee := COALESCE(NEW.review_fee_amount, 0);

  -- قيد إرجاع: يحافظ على المبالغ السالبة ويحدّث الذمة
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

  v_is_plan := (
    NEW.session_kind = 'plan'
    OR (COALESCE(NEW.total_amount, 0) > 0 AND NOT COALESCE(v_locked, FALSE))
  );

  IF v_is_plan AND (COALESCE(NEW.total_amount, 0) > 0 OR v_review_fee > 0) THEN
    v_plan_total := COALESCE(NEW.total_amount, 0) + v_review_fee;

    SELECT
      (d.percentage::TEXT)::NUMERIC / 100,
      (d.materials_share::TEXT)::NUMERIC / 100
    INTO v_doc_pct, v_mat_share
    FROM public.doctors d
    WHERE d.id = NEW.doctor_id;

    v_doc_gross := COALESCE(NEW.total_amount, 0) * v_doc_pct;
    v_doc_share := v_doc_gross - (COALESCE(NEW.materials_cost, 0) * v_mat_share);
    v_clinic_share := (COALESCE(NEW.total_amount, 0) - v_doc_share) + v_review_fee;

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
    NEW.doctor_share_amount := 0;
    NEW.clinic_share_amount := 0;
    NEW.remaining_debt := GREATEST(0, v_plan_total - v_total_paid);

    RETURN NEW;
  END IF;

  NEW.session_kind := 'payment';
  NEW.total_amount := 0;
  NEW.doctor_share_amount := 0;
  NEW.clinic_share_amount := 0;
  NEW.materials_cost := COALESCE(NEW.materials_cost, 0);

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

DROP TRIGGER IF EXISTS trg_calculate_operation_shares ON public.patient_operations;
CREATE TRIGGER trg_calculate_operation_shares
  BEFORE INSERT OR UPDATE ON public.patient_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.calculate_operation_shares();

ALTER TABLE public.session_refunds ENABLE ROW LEVEL SECURITY;

CREATE POLICY session_refunds_select ON public.session_refunds
  FOR SELECT USING (public.tenant_can_access(clinic_id));

CREATE POLICY session_refunds_insert ON public.session_refunds
  FOR INSERT
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

NOTIFY pgrst, 'reload schema';
