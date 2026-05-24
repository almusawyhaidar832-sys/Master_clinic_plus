-- Master Clinic Plus — Initial Multi-Tenant Schema
-- Run via: supabase db push (or paste in Supabase SQL Editor)

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- ENUMS
-- =============================================================================
CREATE TYPE public.user_role AS ENUM (
  'super_admin',
  'accountant',
  'doctor'
);

CREATE TYPE public.doctor_percentage AS ENUM (
  '10', '20', '30', '40', '50', '60', '70', '80'
);

CREATE TYPE public.materials_cost_share AS ENUM (
  '0', '10', '20', '30', '40', '50'
);

CREATE TYPE public.withdrawal_status AS ENUM (
  'pending',
  'approved',
  'paid',
  'rejected'
);

CREATE TYPE public.appointment_status AS ENUM (
  'scheduled',
  'confirmed',
  'completed',
  'cancelled',
  'no_show'
);

CREATE TYPE public.treatment_status AS ENUM (
  'active',
  'completed',
  'cancelled'
);

CREATE TYPE public.salary_entry_type AS ENUM (
  'advance',
  'deduction',
  'absence'
);

CREATE TYPE public.salary_slip_status AS ENUM (
  'draft',
  'paid'
);

CREATE TYPE public.whatsapp_message_type AS ENUM (
  'appointment_confirmation',
  'payment_receipt'
);

-- =============================================================================
-- CLINICS (TENANTS)
-- =============================================================================
CREATE TABLE public.clinics (
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

-- =============================================================================
-- PROFILES (extends auth.users)
-- =============================================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  clinic_id UUID REFERENCES public.clinics(id) ON DELETE CASCADE,
  role public.user_role NOT NULL DEFAULT 'accountant',
  full_name TEXT NOT NULL,
  phone TEXT,
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT profiles_clinic_required CHECK (
    role = 'super_admin' OR clinic_id IS NOT NULL
  )
);

-- =============================================================================
-- OPERATION TYPES (per clinic, fixed dropdown source)
-- =============================================================================
CREATE TABLE public.operation_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name_ar TEXT NOT NULL,
  default_price DECIMAL(12, 2),
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- DOCTORS (financial agreements via fixed enums)
-- =============================================================================
CREATE TABLE public.doctors (
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

-- =============================================================================
-- PATIENTS
-- =============================================================================
CREATE TABLE public.patients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  full_name_ar TEXT NOT NULL,
  phone TEXT,
  national_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_patients_clinic ON public.patients(clinic_id);
CREATE INDEX idx_patients_name ON public.patients(clinic_id, full_name_ar);

-- =============================================================================
-- PATIENT OPERATIONS (ledger entries)
-- =============================================================================
CREATE TABLE public.patient_operations (
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

CREATE INDEX idx_operations_clinic_date ON public.patient_operations(clinic_id, operation_date DESC);
CREATE INDEX idx_operations_patient ON public.patient_operations(patient_id);

-- =============================================================================
-- TREATMENTS (incomplete / multi-session)
-- =============================================================================
CREATE TABLE public.treatments (
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

CREATE INDEX idx_treatments_active ON public.treatments(clinic_id, status) WHERE status = 'active';

-- =============================================================================
-- MEDICAL LOGS
-- =============================================================================
CREATE TABLE public.medical_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  log_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  content_ar TEXT NOT NULL,
  treatment_id UUID REFERENCES public.treatments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- APPOINTMENTS & SCHEDULE LOCKS
-- =============================================================================
CREATE TABLE public.appointments (
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

CREATE TABLE public.schedule_locks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  lock_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  reason_ar TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_appointments_doctor_date ON public.appointments(doctor_id, appointment_date);

-- =============================================================================
-- DOCTOR WALLET & WITHDRAWALS
-- =============================================================================
CREATE TABLE public.doctor_withdrawals (
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

-- =============================================================================
-- EXPENSES
-- =============================================================================
CREATE TABLE public.expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  description_ar TEXT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expenses_clinic_date ON public.expenses(clinic_id, expense_date DESC);

-- =============================================================================
-- STAFF & SALARY (7 employees per clinic)
-- =============================================================================
CREATE TABLE public.staff_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  full_name_ar TEXT NOT NULL,
  job_title_ar TEXT NOT NULL,
  base_salary DECIMAL(12, 2) NOT NULL CHECK (base_salary >= 0),
  phone TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  slot_number INT CHECK (slot_number BETWEEN 1 AND 7),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, slot_number)
);

CREATE TABLE public.salary_entries (
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

CREATE TABLE public.salary_slips (
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, staff_id, month_year)
);

-- =============================================================================
-- WHATSAPP LOG
-- =============================================================================
CREATE TABLE public.whatsapp_messages (
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

-- =============================================================================
-- NOTIFICATIONS (withdrawal alerts to accountant)
-- =============================================================================
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  recipient_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title_ar TEXT NOT NULL,
  body_ar TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  link_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- HELPER: current user's clinic_id
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_my_clinic_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT clinic_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- =============================================================================
-- AUTO-CALCULATE DOCTOR/CLINIC SHARE ON OPERATION INSERT
-- =============================================================================
CREATE OR REPLACE FUNCTION public.calculate_operation_shares()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  doc_pct NUMERIC;
  mat_share NUMERIC;
  clinic_revenue NUMERIC;
  doc_gross NUMERIC;
  mat_amount NUMERIC;
BEGIN
  SELECT
    (d.percentage::TEXT)::NUMERIC / 100,
    (d.materials_share::TEXT)::NUMERIC / 100
  INTO doc_pct, mat_share
  FROM public.doctors d
  WHERE d.id = NEW.doctor_id;

  clinic_revenue := NEW.total_amount;
  doc_gross := clinic_revenue * doc_pct;
  mat_amount := COALESCE(NEW.materials_cost, 0) * mat_share;
  NEW.doctor_share_amount := doc_gross - (COALESCE(NEW.materials_cost, 0) * mat_share);
  NEW.clinic_share_amount := clinic_revenue - NEW.doctor_share_amount;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_calculate_operation_shares
  BEFORE INSERT OR UPDATE ON public.patient_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.calculate_operation_shares();

-- =============================================================================
-- UPDATED_AT TRIGGERS
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_clinics_updated BEFORE UPDATE ON public.clinics
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_doctors_updated BEFORE UPDATE ON public.doctors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_patients_updated BEFORE UPDATE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
ALTER TABLE public.clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treatments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_slips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Profiles: own row + same clinic (for accountants viewing doctors)
CREATE POLICY profiles_select ON public.profiles FOR SELECT USING (
  id = auth.uid()
  OR (clinic_id = public.get_my_clinic_id() AND public.get_my_role() IN ('super_admin', 'accountant'))
);

CREATE POLICY profiles_update_self ON public.profiles FOR UPDATE USING (id = auth.uid());

-- Clinic-scoped tables: tenant isolation
CREATE POLICY clinic_tenant_select ON public.clinics FOR SELECT USING (
  id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin'
);

CREATE POLICY tenant_isolation_select ON public.operation_types FOR SELECT
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');
CREATE POLICY tenant_isolation_mutate ON public.operation_types FOR ALL
  USING (clinic_id = public.get_my_clinic_id() AND public.get_my_role() IN ('super_admin', 'accountant'));

CREATE POLICY doctors_select ON public.doctors FOR SELECT
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');
CREATE POLICY doctors_mutate ON public.doctors FOR ALL
  USING (clinic_id = public.get_my_clinic_id() AND public.get_my_role() IN ('super_admin', 'accountant'));

CREATE POLICY patients_all ON public.patients FOR ALL
  USING (clinic_id = public.get_my_clinic_id());

CREATE POLICY operations_all ON public.patient_operations FOR ALL
  USING (clinic_id = public.get_my_clinic_id());

CREATE POLICY treatments_all ON public.treatments FOR ALL
  USING (clinic_id = public.get_my_clinic_id());

CREATE POLICY medical_logs_all ON public.medical_logs FOR ALL
  USING (clinic_id = public.get_my_clinic_id());

CREATE POLICY appointments_all ON public.appointments FOR ALL
  USING (clinic_id = public.get_my_clinic_id());

CREATE POLICY schedule_locks_all ON public.schedule_locks FOR ALL
  USING (clinic_id = public.get_my_clinic_id());

CREATE POLICY withdrawals_select ON public.doctor_withdrawals FOR SELECT
  USING (clinic_id = public.get_my_clinic_id());
CREATE POLICY withdrawals_doctor_insert ON public.doctor_withdrawals FOR INSERT
  WITH CHECK (
    clinic_id = public.get_my_clinic_id()
    AND doctor_id IN (SELECT id FROM public.doctors WHERE profile_id = auth.uid())
  );
CREATE POLICY withdrawals_accountant_update ON public.doctor_withdrawals FOR UPDATE
  USING (clinic_id = public.get_my_clinic_id() AND public.get_my_role() IN ('accountant', 'super_admin'));

CREATE POLICY expenses_all ON public.expenses FOR ALL
  USING (clinic_id = public.get_my_clinic_id() AND public.get_my_role() IN ('accountant', 'super_admin'));

CREATE POLICY staff_all ON public.staff_members FOR ALL
  USING (clinic_id = public.get_my_clinic_id() AND public.get_my_role() IN ('accountant', 'super_admin'));

CREATE POLICY salary_entries_all ON public.salary_entries FOR ALL
  USING (clinic_id = public.get_my_clinic_id() AND public.get_my_role() IN ('accountant', 'super_admin'));

CREATE POLICY salary_slips_all ON public.salary_slips FOR ALL
  USING (clinic_id = public.get_my_clinic_id() AND public.get_my_role() IN ('accountant', 'super_admin'));

CREATE POLICY whatsapp_all ON public.whatsapp_messages FOR ALL
  USING (clinic_id = public.get_my_clinic_id() AND public.get_my_role() IN ('accountant', 'super_admin'));

CREATE POLICY notifications_own ON public.notifications FOR ALL
  USING (recipient_profile_id = auth.uid());

-- Super admin can see all clinics (platform owner)
CREATE POLICY super_admin_all_clinics ON public.clinics FOR ALL
  USING (public.get_my_role() = 'super_admin');

-- Seed default operation types function (call per clinic on signup)
CREATE OR REPLACE FUNCTION public.seed_default_operation_types(p_clinic_id UUID)
RETURNS void AS $$
BEGIN
  INSERT INTO public.operation_types (clinic_id, name_ar, sort_order) VALUES
    (p_clinic_id, 'كشفية', 1),
    (p_clinic_id, 'حشوة', 2),
    (p_clinic_id, 'خلع', 3),
    (p_clinic_id, 'تنظيف أسنان', 4),
    (p_clinic_id, 'تقويم', 5),
    (p_clinic_id, 'علاج عصب', 6),
    (p_clinic_id, 'تاج / تلبيسة', 7),
    (p_clinic_id, 'أخرى', 99);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
