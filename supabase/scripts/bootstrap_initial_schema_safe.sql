-- =============================================================================
-- Master Clinic Plus — إنشاء الجداول الناقصة فقط (آمن إذا شغّلت fix-apply-tenant-rls.sql)
-- =============================================================================
-- لا تشغّل 20260523000000_initial_schema.sql كاملاً إذا ظهر:
--   type "user_role" already exists
--
-- هذا الملف:
--   • يتخطى الأنواع (ENUM) الموجودة
--   • ينشئ الجداول بـ CREATE TABLE IF NOT EXISTS
--   • لا يضيف سياسات RLS القديمة (استخدم fix-apply-tenant-rls.sql)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── ENUMs (تخطي إن وُجدت) ───────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE public.user_role AS ENUM ('super_admin','accountant','doctor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.doctor_percentage AS ENUM ('10','20','30','40','50','60','70','80');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.materials_cost_share AS ENUM ('0','10','20','30','40','50');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.withdrawal_status AS ENUM ('pending','approved','paid','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.appointment_status AS ENUM ('scheduled','confirmed','completed','cancelled','no_show');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.treatment_status AS ENUM ('active','completed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.salary_entry_type AS ENUM ('advance','deduction','absence');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.salary_slip_status AS ENUM ('draft','paid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.whatsapp_message_type AS ENUM ('appointment_confirmation','payment_receipt');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── جداول أساسية ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clinics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  name_ar TEXT,
  phone TEXT,
  address TEXT,
  logo_url TEXT,
  whatsapp_linked BOOLEAN DEFAULT FALSE,
  whatsapp_session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  clinic_id UUID REFERENCES public.clinics(id) ON DELETE CASCADE,
  role public.user_role NOT NULL DEFAULT 'accountant',
  full_name TEXT NOT NULL,
  phone TEXT,
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.operation_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name_ar TEXT NOT NULL,
  default_price DECIMAL(12, 2),
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.doctors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  full_name_ar TEXT NOT NULL,
  specialty_ar TEXT,
  phone TEXT,
  percentage public.doctor_percentage NOT NULL DEFAULT '50',
  materials_share public.materials_cost_share NOT NULL DEFAULT '0',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.patients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  full_name_ar TEXT NOT NULL,
  phone TEXT,
  national_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.patient_operations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  operation_type_id UUID REFERENCES public.operation_types(id) ON DELETE SET NULL,
  operation_name_ar TEXT NOT NULL,
  operation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_amount DECIMAL(12, 2) NOT NULL CHECK (total_amount >= 0),
  paid_amount DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  remaining_debt DECIMAL(12, 2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
  doctor_share_amount DECIMAL(12, 2),
  clinic_share_amount DECIMAL(12, 2),
  materials_cost DECIMAL(12, 2) DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'patient_operations'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'patient_operations'
      AND column_name = 'remaining_debt'
  ) THEN
    ALTER TABLE public.patient_operations
      ADD COLUMN remaining_debt DECIMAL(12, 2)
      GENERATED ALWAYS AS (total_amount - paid_amount) STORED;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.treatments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  title_ar TEXT NOT NULL,
  description_ar TEXT,
  status public.treatment_status NOT NULL DEFAULT 'active',
  started_at DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_sessions INT DEFAULT 1,
  completed_sessions INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.medical_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  log_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  content_ar TEXT NOT NULL,
  treatment_id UUID REFERENCES public.treatments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.appointments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES public.patients(id) ON DELETE SET NULL,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  patient_name_ar TEXT,
  patient_phone TEXT,
  appointment_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status public.appointment_status NOT NULL DEFAULT 'scheduled',
  notes TEXT,
  whatsapp_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.schedule_locks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  lock_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  reason_ar TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.doctor_withdrawals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  status public.withdrawal_status NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  processed_by UUID REFERENCES public.profiles(id),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  description_ar TEXT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.staff_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  full_name_ar TEXT NOT NULL,
  job_title_ar TEXT NOT NULL,
  base_salary DECIMAL(12, 2) NOT NULL CHECK (base_salary >= 0),
  phone TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  slot_number INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.salary_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  entry_type public.salary_entry_type NOT NULL,
  amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes_ar TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.salary_slips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  month_year TEXT NOT NULL,
  base_salary DECIMAL(12, 2) NOT NULL,
  total_advances DECIMAL(12, 2) NOT NULL DEFAULT 0,
  total_deductions DECIMAL(12, 2) NOT NULL DEFAULT 0,
  net_payout DECIMAL(12, 2) NOT NULL,
  status public.salary_slip_status NOT NULL DEFAULT 'draft',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  message_type public.whatsapp_message_type NOT NULL,
  recipient_phone TEXT NOT NULL,
  message_body_ar TEXT NOT NULL,
  sent_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending',
  related_operation_id UUID REFERENCES public.patient_operations(id),
  related_appointment_id UUID REFERENCES public.appointments(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  recipient_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title_ar TEXT NOT NULL,
  body_ar TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  link_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- فهارس (إن لم تكن موجودة)
CREATE INDEX IF NOT EXISTS idx_patients_clinic ON public.patients(clinic_id);
CREATE INDEX IF NOT EXISTS idx_patients_name ON public.patients(clinic_id, full_name_ar);
CREATE INDEX IF NOT EXISTS idx_operations_clinic_date ON public.patient_operations(clinic_id, operation_date DESC);
CREATE INDEX IF NOT EXISTS idx_operations_patient ON public.patient_operations(patient_id);
CREATE INDEX IF NOT EXISTS idx_treatments_active ON public.treatments(clinic_id, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_appointments_doctor_date ON public.appointments(doctor_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_expenses_clinic_date ON public.expenses(clinic_id, expense_date DESC);

-- دوال مساعدة
CREATE OR REPLACE FUNCTION public.get_my_clinic_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT clinic_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS public.user_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.calculate_operation_shares()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  doc_pct NUMERIC;
  mat_share NUMERIC;
  clinic_revenue NUMERIC;
  doc_gross NUMERIC;
BEGIN
  SELECT
    (d.percentage::TEXT)::NUMERIC / 100,
    (d.materials_share::TEXT)::NUMERIC / 100
  INTO doc_pct, mat_share
  FROM public.doctors d
  WHERE d.id = NEW.doctor_id;

  clinic_revenue := NEW.total_amount;
  doc_gross := clinic_revenue * doc_pct;
  NEW.doctor_share_amount := doc_gross - (COALESCE(NEW.materials_cost, 0) * mat_share);
  NEW.clinic_share_amount := clinic_revenue - NEW.doctor_share_amount;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_calculate_operation_shares ON public.patient_operations;
CREATE TRIGGER trg_calculate_operation_shares
  BEFORE INSERT OR UPDATE ON public.patient_operations
  FOR EACH ROW EXECUTE FUNCTION public.calculate_operation_shares();

DROP TRIGGER IF EXISTS trg_clinics_updated ON public.clinics;
CREATE TRIGGER trg_clinics_updated BEFORE UPDATE ON public.clinics
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_profiles_updated ON public.profiles;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_doctors_updated ON public.doctors;
CREATE TRIGGER trg_doctors_updated BEFORE UPDATE ON public.doctors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_patients_updated ON public.patients;
CREATE TRIGGER trg_patients_updated BEFORE UPDATE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.seed_default_operation_types(p_clinic_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.operation_types (clinic_id, name_ar, sort_order)
  SELECT p_clinic_id, v.name_ar, v.sort_order
  FROM (VALUES
    ('كشفية', 1), ('حشوة', 2), ('خلع', 3), ('تنظيف أسنان', 4),
    ('تقويم', 5), ('علاج عصب', 6), ('تاج / تلبيسة', 7), ('أخرى', 99)
  ) AS v(name_ar, sort_order)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.operation_types o
    WHERE o.clinic_id = p_clinic_id AND o.name_ar = v.name_ar
  );
END;
$$;

-- تقرير الجداول
DO $$
DECLARE
  r RECORD;
BEGIN
  RAISE NOTICE '── الجداول في public ──';
  FOR r IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  LOOP
    RAISE NOTICE '  • %', r.table_name;
  END LOOP;
  RAISE NOTICE '✓ bootstrap_initial_schema_safe.sql اكتمل';
  RAISE NOTICE 'الخطوة التالية: أعد تشغيل fix-apply-tenant-rls.sql لتطبيق RLS على الجداول الجديدة';
END $$;
