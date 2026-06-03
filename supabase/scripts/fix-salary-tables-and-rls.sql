-- رواتب الموظفين: إنشاء الجداول الناقصة + سياسات RLS
-- شغّل كاملاً في Supabase → SQL Editor إذا ظهر:
--   relation "public.salary_entries" does not exist

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── أنواع ENUM ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.salary_entry_type AS ENUM ('advance', 'deduction', 'absence');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.salary_slip_status AS ENUM ('draft', 'paid');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── جدول الموظفين (إن لم يكن موجوداً) ─────────────────────────────────────
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, slot_number)
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, staff_id, month_year)
);

-- فهارس مفيدة
CREATE INDEX IF NOT EXISTS idx_salary_entries_staff_date
  ON public.salary_entries (staff_id, entry_date DESC);

CREATE INDEX IF NOT EXISTS idx_salary_slips_clinic_month
  ON public.salary_slips (clinic_id, month_year);

-- RLS
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_slips ENABLE ROW LEVEL SECURITY;

-- محفّز clinic_id عند الإدراج (إن وُجدت الدالة)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'set_clinic_id_from_profile' AND pronamespace = 'public'::regnamespace
  ) THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_staff_clinic') THEN
      CREATE TRIGGER trg_staff_clinic
        BEFORE INSERT ON public.staff_members
        FOR EACH ROW EXECUTE FUNCTION public.set_clinic_id_from_profile();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_salary_entries_clinic') THEN
      CREATE TRIGGER trg_salary_entries_clinic
        BEFORE INSERT ON public.salary_entries
        FOR EACH ROW EXECUTE FUNCTION public.set_clinic_id_from_profile();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_salary_slips_clinic') THEN
      CREATE TRIGGER trg_salary_slips_clinic
        BEFORE INSERT ON public.salary_slips
        FOR EACH ROW EXECUTE FUNCTION public.set_clinic_id_from_profile();
    END IF;
  END IF;
END $$;

-- ── سياسات RLS (رواتب) ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS staff_all ON public.staff_members;
DROP POLICY IF EXISTS staff_select ON public.staff_members;
DROP POLICY IF EXISTS staff_insert ON public.staff_members;
DROP POLICY IF EXISTS staff_update ON public.staff_members;
DROP POLICY IF EXISTS staff_delete ON public.staff_members;

CREATE POLICY staff_select ON public.staff_members
  FOR SELECT USING (public.tenant_can_access(clinic_id));

CREATE POLICY staff_insert ON public.staff_members
  FOR INSERT
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

CREATE POLICY staff_update ON public.staff_members
  FOR UPDATE
  USING (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  )
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

CREATE POLICY staff_delete ON public.staff_members
  FOR DELETE
  USING (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

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
  FOR INSERT
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

CREATE POLICY salary_entries_update ON public.salary_entries
  FOR UPDATE
  USING (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  )
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

CREATE POLICY salary_entries_delete ON public.salary_entries
  FOR DELETE
  USING (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

CREATE POLICY salary_slips_select ON public.salary_slips
  FOR SELECT USING (public.tenant_can_access(clinic_id));

CREATE POLICY salary_slips_insert ON public.salary_slips
  FOR INSERT
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

CREATE POLICY salary_slips_update ON public.salary_slips
  FOR UPDATE
  USING (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  )
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

CREATE POLICY salary_slips_delete ON public.salary_slips
  FOR DELETE
  USING (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

-- ── تصفير لوحة الرواتب (إغلاق الشهر) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.salary_month_closures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  month_year TEXT NOT NULL,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_by UUID REFERENCES public.profiles(id),
  UNIQUE (clinic_id, month_year)
);

CREATE INDEX IF NOT EXISTS idx_salary_month_closures_clinic
  ON public.salary_month_closures (clinic_id, month_year DESC);

ALTER TABLE public.salary_month_closures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS salary_closures_select ON public.salary_month_closures;
DROP POLICY IF EXISTS salary_closures_insert ON public.salary_month_closures;

CREATE POLICY salary_closures_select ON public.salary_month_closures
  FOR SELECT USING (public.tenant_can_access(clinic_id));

CREATE POLICY salary_closures_insert ON public.salary_month_closures
  FOR INSERT
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

NOTIFY pgrst, 'reload schema';
