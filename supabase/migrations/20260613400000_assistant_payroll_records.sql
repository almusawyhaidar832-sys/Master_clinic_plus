-- Assistant monthly payroll snapshots (immutable per month)
-- Run via: supabase db push  OR  Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.payroll_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  assistant_id UUID NOT NULL REFERENCES public.assistants(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  month_year TEXT NOT NULL CHECK (month_year ~ '^\d{4}-\d{2}$'),
  assistant_name_ar TEXT NOT NULL,
  doctor_name_ar TEXT,
  total_salary DECIMAL(12, 2) NOT NULL CHECK (total_salary >= 0),
  doctor_share_percentage NUMERIC(5, 2) NOT NULL
    CHECK (doctor_share_percentage >= 0 AND doctor_share_percentage <= 100),
  doctor_share_amount DECIMAL(12, 2) NOT NULL CHECK (doctor_share_amount >= 0),
  clinic_share_amount DECIMAL(12, 2) NOT NULL CHECK (clinic_share_amount >= 0),
  status TEXT NOT NULL DEFAULT 'generated'
    CHECK (status IN ('generated', 'paid')),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_records_assistant_month
  ON public.payroll_records(clinic_id, assistant_id, month_year);

CREATE INDEX IF NOT EXISTS idx_payroll_records_clinic_month
  ON public.payroll_records(clinic_id, month_year DESC);

CREATE INDEX IF NOT EXISTS idx_payroll_records_doctor_month
  ON public.payroll_records(doctor_id, month_year DESC);

COMMENT ON TABLE public.payroll_records IS
  'لقطة رواتب المساعدين الشهرية — قيم ثابتة لا تتأثر بتعديل الراتب لاحقاً';

-- Auto clinic_id on insert
DROP TRIGGER IF EXISTS trg_payroll_records_clinic ON public.payroll_records;
CREATE TRIGGER trg_payroll_records_clinic
  BEFORE INSERT ON public.payroll_records
  FOR EACH ROW EXECUTE FUNCTION public.set_clinic_id_from_profile();

-- RLS
ALTER TABLE public.payroll_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_records_tenant_select ON public.payroll_records;
DROP POLICY IF EXISTS payroll_records_tenant_mutate ON public.payroll_records;

CREATE POLICY payroll_records_tenant_select ON public.payroll_records
  FOR SELECT TO authenticated
  USING (public.tenant_can_access(clinic_id));

CREATE POLICY payroll_records_tenant_mutate ON public.payroll_records
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_records TO authenticated;
