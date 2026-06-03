-- =============================================================================
-- Master Clinic Plus — تطبيق كل الإصلاحات الحرجة دفعة واحدة
-- انسخ هذا الملف كاملاً إلى Supabase → SQL Editor → Run
-- آمن لإعادة التشغيل
-- =============================================================================

-- A) محفظة الطبيب + السحوبات (إصلاح access denied عند الدفع النقدي)

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

-- B) غرفة الانتظار — جدول + RLS (إن لم يكن موجوداً)
-- إذا فشل هذا القسم، شغّل ملف: migrations/20260601000001_competitive_features.sql

DO $$ BEGIN
  CREATE TYPE public.queue_status AS ENUM (
    'waiting', 'called', 'in_progress', 'done', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.queue_source AS ENUM ('walk_in', 'appointment', 'online');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.patient_queue (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id      UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  doctor_id      UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  patient_id     UUID REFERENCES public.patients(id) ON DELETE SET NULL,
  patient_name   TEXT,
  patient_phone  TEXT,
  ticket_number  INT NOT NULL DEFAULT 1,
  status         public.queue_status NOT NULL DEFAULT 'waiting',
  source         public.queue_source NOT NULL DEFAULT 'walk_in',
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  notes          TEXT,
  queue_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  called_at      TIMESTAMPTZ,
  entered_at     TIMESTAMPTZ,
  done_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, doctor_id, ticket_number, queue_date)
);

ALTER TABLE public.patient_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS queue_select ON public.patient_queue;
CREATE POLICY queue_select ON public.patient_queue FOR SELECT
  USING (public.tenant_can_access(clinic_id));

DROP POLICY IF EXISTS queue_insert ON public.patient_queue;
CREATE POLICY queue_insert ON public.patient_queue FOR INSERT
  WITH CHECK (public.tenant_can_access(clinic_id));

DROP POLICY IF EXISTS queue_update ON public.patient_queue;
CREATE POLICY queue_update ON public.patient_queue FOR UPDATE
  USING (public.tenant_can_access(clinic_id))
  WITH CHECK (public.tenant_can_access(clinic_id));

DROP POLICY IF EXISTS queue_delete ON public.patient_queue;
CREATE POLICY queue_delete ON public.patient_queue FOR DELETE
  USING (public.tenant_can_access(clinic_id) AND public.get_my_role() IN ('accountant','super_admin'));

DROP TRIGGER IF EXISTS trg_patient_queue_clinic ON public.patient_queue;
CREATE TRIGGER trg_patient_queue_clinic
  BEFORE INSERT ON public.patient_queue
  FOR EACH ROW EXECUTE FUNCTION public.set_clinic_id_from_profile();

CREATE OR REPLACE FUNCTION public.assign_ticket_number()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_next INT;
BEGIN
  IF NEW.ticket_number IS NULL OR NEW.ticket_number <= 0 THEN
    SELECT COALESCE(MAX(ticket_number), 0) + 1 INTO v_next
    FROM public.patient_queue
    WHERE doctor_id = NEW.doctor_id
      AND queue_date = NEW.queue_date
      AND clinic_id = NEW.clinic_id;
    NEW.ticket_number := v_next;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_ticket ON public.patient_queue;
CREATE TRIGGER trg_assign_ticket
  BEFORE INSERT ON public.patient_queue
  FOR EACH ROW EXECUTE FUNCTION public.assign_ticket_number();

DO $$ BEGIN
  CREATE TYPE public.withdrawal_source AS ENUM ('doctor_request', 'accountant_cash');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- C) رواتب — سياسات RLS (إن وُجدت الجداول)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'salary_entries'
  ) THEN
    RETURN;
  END IF;

  EXECUTE $p$
DROP POLICY IF EXISTS salary_entries_all ON public.salary_entries;
DROP POLICY IF EXISTS salary_slips_all ON public.salary_slips;
DROP POLICY IF EXISTS salary_entries_select ON public.salary_entries;
DROP POLICY IF EXISTS salary_entries_insert ON public.salary_entries;
DROP POLICY IF EXISTS salary_entries_update ON public.salary_entries;
DROP POLICY IF EXISTS salary_entries_delete ON public.salary_entries;
DROP POLICY IF EXISTS salary_slips_select ON public.salary_slips;
DROP POLICY IF EXISTS salary_slips_insert ON public.salary_slips;
DROP POLICY IF EXISTS salary_slips_update ON public.salary_slips;
DROP POLICY IF EXISTS salary_slips_delete ON public.salary_slips;

CREATE POLICY salary_entries_select ON public.salary_entries
  FOR SELECT USING (public.tenant_can_access(clinic_id));
CREATE POLICY salary_entries_insert ON public.salary_entries
  FOR INSERT WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );
CREATE POLICY salary_entries_update ON public.salary_entries
  FOR UPDATE
  USING (public.tenant_can_access(clinic_id) AND public.get_my_role() IN ('accountant', 'super_admin'))
  WITH CHECK (public.tenant_can_access(clinic_id) AND public.get_my_role() IN ('accountant', 'super_admin'));
CREATE POLICY salary_slips_select ON public.salary_slips
  FOR SELECT USING (public.tenant_can_access(clinic_id));
CREATE POLICY salary_slips_insert ON public.salary_slips
  FOR INSERT WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );
CREATE POLICY salary_slips_update ON public.salary_slips
  FOR UPDATE
  USING (public.tenant_can_access(clinic_id) AND public.get_my_role() IN ('accountant', 'super_admin'))
  WITH CHECK (public.tenant_can_access(clinic_id) AND public.get_my_role() IN ('accountant', 'super_admin'));
  $p$;
END $$;

-- D) سحوبات — صلاحيات المحاسب
DROP POLICY IF EXISTS withdrawals_staff_update ON public.doctor_withdrawals;
CREATE POLICY withdrawals_staff_update ON public.doctor_withdrawals
  FOR UPDATE
  USING (public.tenant_can_access(clinic_id) AND public.get_my_role() IN ('accountant', 'super_admin'))
  WITH CHECK (public.tenant_can_access(clinic_id) AND public.get_my_role() IN ('accountant', 'super_admin'));

DROP POLICY IF EXISTS withdrawals_accountant_insert ON public.doctor_withdrawals;
CREATE POLICY withdrawals_accountant_insert ON public.doctor_withdrawals
  FOR INSERT
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
    AND status = 'paid'
  );

ALTER TABLE public.doctor_withdrawals
  ADD COLUMN IF NOT EXISTS source public.withdrawal_source NOT NULL DEFAULT 'doctor_request';
ALTER TABLE public.doctor_withdrawals
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
ALTER TABLE public.doctor_withdrawals
  ADD COLUMN IF NOT EXISTS processed_by UUID REFERENCES public.profiles(id);

-- E) ربط الملف الشخصي بالعيادة (شغّله وأنت مسجّل دخول في SQL Editor)
-- SELECT public.link_profile_to_first_clinic();

-- F) ديون «اليوم» — محاذاة operation_date مع وقت التسجيل (بغداد)
UPDATE public.patient_operations
SET operation_date = (created_at AT TIME ZONE 'Asia/Baghdad')::date
WHERE operation_date IS NULL
   OR operation_date < (created_at AT TIME ZONE 'Asia/Baghdad')::date;

-- G) ديون المراجعين في اللوحة (زوار الفترة + ذمتهم) — انسخ أيضاً:
-- supabase/migrations/20260604000001_period_visitor_debt.sql

NOTIFY pgrst, 'reload schema';
