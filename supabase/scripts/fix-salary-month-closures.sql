-- تصفير لوحة الرواتب — شغّل في Supabase → SQL Editor
-- يصلح: Could not find the table 'public.salary_month_closures' in the schema cache

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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
