-- Master Clinic Plus — Multi-tenant features: assistants, doctor_expenses, invoices
-- Run via: supabase db push  OR  paste in Supabase SQL Editor
--
-- Tables: assistants, doctor_expenses, invoices
-- Updates: clinics (barcode), appointments (assistant_id)
-- RLS: tenant_can_access(clinic_id) on all new tables

-- =============================================================================
-- 0) PREREQUISITES — tenant helpers (idempotent)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.platform_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.get_platform_admin_email()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT lower(trim(value))
  FROM public.platform_settings
  WHERE key = 'admin_email'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM auth.users u
      WHERE u.id = auth.uid()
        AND lower(trim(coalesce(u.email, ''))) = coalesce(public.get_platform_admin_email(), '')
    );
$$;

CREATE OR REPLACE FUNCTION public.get_my_clinic_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT clinic_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS public.user_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.tenant_can_access(p_clinic_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_admin()
    OR (
      p_clinic_id IS NOT NULL
      AND p_clinic_id = public.get_my_clinic_id()
    );
$$;

-- =============================================================================
-- 1) CLINICS — تفاصيل العيادة + باركود الحجز (QR)
-- =============================================================================
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS booking_code TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS owner_email TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_instance_name TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_api_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clinics_booking_code
  ON public.clinics (booking_code)
  WHERE booking_code IS NOT NULL;

COMMENT ON COLUMN public.clinics.booking_code IS
  'رمز/باركود العيادة العام — يُستخدم في QR والحجز الإلكتروني (/booking?clinic=CODE)';

-- توليد باركود تلقائي للعيادات الجديدة
CREATE OR REPLACE FUNCTION public.generate_booking_code()
RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  v_chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code TEXT;
  v_i INT;
  v_attempt INT := 0;
BEGIN
  LOOP
    v_code := '';
    FOR v_i IN 1..8 LOOP
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::INT, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.clinics c WHERE c.booking_code = v_code
    );
    v_attempt := v_attempt + 1;
    IF v_attempt > 50 THEN
      RAISE EXCEPTION 'Could not generate unique booking_code';
    END IF;
  END LOOP;
  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_clinic_booking_code()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.booking_code IS NULL OR btrim(NEW.booking_code) = '' THEN
    NEW.booking_code := public.generate_booking_code();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_clinic_booking_code ON public.clinics;
CREATE TRIGGER trg_set_clinic_booking_code
  BEFORE INSERT ON public.clinics
  FOR EACH ROW
  EXECUTE FUNCTION public.set_clinic_booking_code();

UPDATE public.clinics
SET booking_code = public.generate_booking_code()
WHERE booking_code IS NULL OR btrim(booking_code) = '';

-- =============================================================================
-- 2) ASSISTANTS — مساعدو الأطباء (لكل عيادة)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.assistants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  full_name_ar TEXT NOT NULL,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assistants_clinic
  ON public.assistants(clinic_id);
CREATE INDEX IF NOT EXISTS idx_assistants_doctor
  ON public.assistants(doctor_id);
CREATE INDEX IF NOT EXISTS idx_assistants_clinic_active
  ON public.assistants(clinic_id, is_active)
  WHERE is_active = TRUE;

COMMENT ON TABLE public.assistants IS
  'مساعدو الأطباء — مرتبطون بعيادة واحدة وطبيب واحد';

-- =============================================================================
-- 3) DOCTOR_EXPENSES — صرفيات الطبيب (فواتير + نسبة التقسيم)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.doctor_expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  percentage_split NUMERIC(5, 2) NOT NULL DEFAULT 50
    CHECK (percentage_split >= 0 AND percentage_split <= 100),
  invoice_storage_path TEXT,
  invoice_file_name TEXT,
  invoice_mime_type TEXT,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  description_ar TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doctor_expenses_clinic_date
  ON public.doctor_expenses(clinic_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_doctor_expenses_doctor
  ON public.doctor_expenses(doctor_id, expense_date DESC);

COMMENT ON COLUMN public.doctor_expenses.percentage_split IS
  'نسبة حصة الطبيب من مبلغ الصرفية (0–100) — الباقي للعيادة';
COMMENT ON COLUMN public.doctor_expenses.invoice_storage_path IS
  'مسار صورة الفاتورة في bucket: doctor-expense-invoices';

-- =============================================================================
-- 4) APPOINTMENTS — إضافة assistant_id (اختياري)
-- =============================================================================
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS assistant_id UUID
    REFERENCES public.assistants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_assistant
  ON public.appointments(assistant_id)
  WHERE assistant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_clinic_date
  ON public.appointments(clinic_id, appointment_date DESC);

-- =============================================================================
-- 5) INVOICES — فواتير المرضى (مبلغ، مدفوع، متبقي، أشعة)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES public.patients(id) ON DELETE SET NULL,
  doctor_id UUID REFERENCES public.doctors(id) ON DELETE SET NULL,
  operation_id UUID REFERENCES public.patient_operations(id) ON DELETE SET NULL,
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  total_amount DECIMAL(12, 2) NOT NULL CHECK (total_amount >= 0),
  paid_amount DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  remaining_amount DECIMAL(12, 2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
  xray_storage_path TEXT,
  xray_file_name TEXT,
  xray_mime_type TEXT,
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT invoices_paid_not_exceed_total CHECK (paid_amount <= total_amount)
);

CREATE INDEX IF NOT EXISTS idx_invoices_clinic_date
  ON public.invoices(clinic_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_patient
  ON public.invoices(patient_id);
CREATE INDEX IF NOT EXISTS idx_invoices_operation
  ON public.invoices(operation_id)
  WHERE operation_id IS NOT NULL;

COMMENT ON COLUMN public.invoices.xray_storage_path IS
  'مسار صورة الأشعة في bucket: invoice-xrays';

-- =============================================================================
-- 6) CROSS-TENANT VALIDATION TRIGGERS
-- =============================================================================
CREATE OR REPLACE FUNCTION public.validate_assistant_clinic_match()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_doctor_clinic UUID;
BEGIN
  SELECT clinic_id INTO v_doctor_clinic
  FROM public.doctors WHERE id = NEW.doctor_id;

  IF v_doctor_clinic IS NULL THEN
    RAISE EXCEPTION 'doctor_id غير موجود';
  END IF;

  IF NEW.clinic_id IS DISTINCT FROM v_doctor_clinic THEN
    RAISE EXCEPTION 'clinic_id للمساعد يجب أن يطابق عيادة الطبيب';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assistants_clinic_match ON public.assistants;
CREATE TRIGGER trg_assistants_clinic_match
  BEFORE INSERT OR UPDATE ON public.assistants
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_assistant_clinic_match();

CREATE OR REPLACE FUNCTION public.validate_doctor_expense_clinic_match()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_doctor_clinic UUID;
BEGIN
  SELECT clinic_id INTO v_doctor_clinic
  FROM public.doctors WHERE id = NEW.doctor_id;

  IF v_doctor_clinic IS NULL THEN
    RAISE EXCEPTION 'doctor_id غير موجود';
  END IF;

  IF NEW.clinic_id IS DISTINCT FROM v_doctor_clinic THEN
    RAISE EXCEPTION 'clinic_id للصرفية يجب أن يطابق عيادة الطبيب';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_doctor_expenses_clinic_match ON public.doctor_expenses;
CREATE TRIGGER trg_doctor_expenses_clinic_match
  BEFORE INSERT OR UPDATE ON public.doctor_expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_doctor_expense_clinic_match();

CREATE OR REPLACE FUNCTION public.validate_appointment_assistant()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_assistant RECORD;
BEGIN
  IF NEW.assistant_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT clinic_id, doctor_id INTO v_assistant
  FROM public.assistants WHERE id = NEW.assistant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'assistant_id غير موجود';
  END IF;

  IF NEW.clinic_id IS DISTINCT FROM v_assistant.clinic_id THEN
    RAISE EXCEPTION 'المساعد لا ينتمي لنفس العيادة';
  END IF;

  IF NEW.doctor_id IS DISTINCT FROM v_assistant.doctor_id THEN
    RAISE EXCEPTION 'المساعد لا ينتمي لنفس الطبيب';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_appointments_assistant ON public.appointments;
CREATE TRIGGER trg_appointments_assistant
  BEFORE INSERT OR UPDATE ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_appointment_assistant();

CREATE OR REPLACE FUNCTION public.validate_invoice_clinic_refs()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ref_clinic UUID;
BEGIN
  IF NEW.patient_id IS NOT NULL THEN
    SELECT clinic_id INTO v_ref_clinic FROM public.patients WHERE id = NEW.patient_id;
    IF v_ref_clinic IS DISTINCT FROM NEW.clinic_id THEN
      RAISE EXCEPTION 'المريض لا ينتمي لنفس العيادة';
    END IF;
  END IF;

  IF NEW.doctor_id IS NOT NULL THEN
    SELECT clinic_id INTO v_ref_clinic FROM public.doctors WHERE id = NEW.doctor_id;
    IF v_ref_clinic IS DISTINCT FROM NEW.clinic_id THEN
      RAISE EXCEPTION 'الطبيب لا ينتمي لنفس العيادة';
    END IF;
  END IF;

  IF NEW.operation_id IS NOT NULL THEN
    SELECT clinic_id INTO v_ref_clinic FROM public.patient_operations WHERE id = NEW.operation_id;
    IF v_ref_clinic IS DISTINCT FROM NEW.clinic_id THEN
      RAISE EXCEPTION 'الجلسة لا تنتمي لنفس العيادة';
    END IF;
  END IF;

  IF NEW.appointment_id IS NOT NULL THEN
    SELECT clinic_id INTO v_ref_clinic FROM public.appointments WHERE id = NEW.appointment_id;
    IF v_ref_clinic IS DISTINCT FROM NEW.clinic_id THEN
      RAISE EXCEPTION 'الموعد لا ينتمي لنفس العيادة';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_clinic_refs ON public.invoices;
CREATE TRIGGER trg_invoices_clinic_refs
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_invoice_clinic_refs();

-- =============================================================================
-- 7) AUTO clinic_id ON INSERT
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_clinic_id_from_profile()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.clinic_id IS NULL THEN
    NEW.clinic_id := public.get_my_clinic_id();
  END IF;
  IF NEW.clinic_id IS NULL THEN
    RAISE EXCEPTION 'clinic_id required';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assistants_clinic ON public.assistants;
CREATE TRIGGER trg_assistants_clinic
  BEFORE INSERT ON public.assistants
  FOR EACH ROW EXECUTE FUNCTION public.set_clinic_id_from_profile();

DROP TRIGGER IF EXISTS trg_doctor_expenses_clinic ON public.doctor_expenses;
CREATE TRIGGER trg_doctor_expenses_clinic
  BEFORE INSERT ON public.doctor_expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_clinic_id_from_profile();

DROP TRIGGER IF EXISTS trg_invoices_clinic ON public.invoices;
CREATE TRIGGER trg_invoices_clinic
  BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_clinic_id_from_profile();

-- =============================================================================
-- 8) UPDATED_AT TRIGGERS
-- =============================================================================
DROP TRIGGER IF EXISTS trg_assistants_updated ON public.assistants;
CREATE TRIGGER trg_assistants_updated
  BEFORE UPDATE ON public.assistants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_invoices_updated ON public.invoices;
CREATE TRIGGER trg_invoices_updated
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- 9) STORAGE BUCKETS (صور الفواتير والأشعة)
-- =============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'doctor-expense-invoices',
  'doctor-expense-invoices',
  FALSE,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'invoice-xrays',
  'invoice-xrays',
  FALSE,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 10) ROW LEVEL SECURITY — عزل تام حسب clinic_id
-- =============================================================================

-- assistants
ALTER TABLE public.assistants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistants_tenant_select ON public.assistants;
DROP POLICY IF EXISTS assistants_tenant_mutate ON public.assistants;
DROP POLICY IF EXISTS assistants_tenant ON public.assistants;

CREATE POLICY assistants_tenant_select ON public.assistants
  FOR SELECT TO authenticated
  USING (public.tenant_can_access(clinic_id));

CREATE POLICY assistants_tenant_mutate ON public.assistants
  FOR ALL TO authenticated
  USING (
    public.tenant_can_access(clinic_id)
    AND (
      public.is_platform_admin()
      OR public.get_my_role() IN ('accountant', 'super_admin')
    )
  )
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND (
      public.is_platform_admin()
      OR public.get_my_role() IN ('accountant', 'super_admin')
    )
  );

-- doctor_expenses
ALTER TABLE public.doctor_expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS doctor_expenses_tenant_select ON public.doctor_expenses;
DROP POLICY IF EXISTS doctor_expenses_tenant_mutate ON public.doctor_expenses;
DROP POLICY IF EXISTS doctor_expenses_tenant ON public.doctor_expenses;

CREATE POLICY doctor_expenses_tenant_select ON public.doctor_expenses
  FOR SELECT TO authenticated
  USING (public.tenant_can_access(clinic_id));

CREATE POLICY doctor_expenses_tenant_mutate ON public.doctor_expenses
  FOR ALL TO authenticated
  USING (
    public.tenant_can_access(clinic_id)
    AND (
      public.is_platform_admin()
      OR public.get_my_role() IN ('accountant', 'super_admin')
      OR doctor_id IN (SELECT id FROM public.doctors WHERE profile_id = auth.uid())
    )
  )
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND (
      public.is_platform_admin()
      OR public.get_my_role() IN ('accountant', 'super_admin')
      OR doctor_id IN (SELECT id FROM public.doctors WHERE profile_id = auth.uid())
    )
  );

-- invoices
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoices_tenant_select ON public.invoices;
DROP POLICY IF EXISTS invoices_tenant_mutate ON public.invoices;
DROP POLICY IF EXISTS invoices_tenant ON public.invoices;

CREATE POLICY invoices_tenant_select ON public.invoices
  FOR SELECT TO authenticated
  USING (public.tenant_can_access(clinic_id));

CREATE POLICY invoices_tenant_mutate ON public.invoices
  FOR ALL TO authenticated
  USING (
    public.tenant_can_access(clinic_id)
    AND (
      public.is_platform_admin()
      OR public.get_my_role() IN ('accountant', 'super_admin', 'doctor')
    )
  )
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND (
      public.is_platform_admin()
      OR public.get_my_role() IN ('accountant', 'super_admin', 'doctor')
    )
  );

-- appointments — إعادة تأكيد العزل (clinic_id + assistant_id)
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS appointments_all ON public.appointments;
DROP POLICY IF EXISTS appointments_tenant ON public.appointments;
DROP POLICY IF EXISTS appointments_tenant_select ON public.appointments;
DROP POLICY IF EXISTS appointments_tenant_mutate ON public.appointments;

CREATE POLICY appointments_tenant_select ON public.appointments
  FOR SELECT TO authenticated
  USING (public.tenant_can_access(clinic_id));

CREATE POLICY appointments_tenant_mutate ON public.appointments
  FOR ALL TO authenticated
  USING (
    public.tenant_can_access(clinic_id)
    AND (
      public.is_platform_admin()
      OR public.get_my_role() IN ('accountant', 'super_admin', 'doctor')
    )
  )
  WITH CHECK (public.tenant_can_access(clinic_id));

-- =============================================================================
-- 11) GRANTS
-- =============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assistants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.doctor_expenses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
