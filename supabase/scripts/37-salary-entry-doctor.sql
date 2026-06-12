-- شغّل في Supabase SQL Editor — رواتب أطباء الراتب الثابت (سلف/خصم/مكافأة/غياب)
ALTER TABLE public.salary_slips
  ALTER COLUMN staff_id DROP NOT NULL;

ALTER TABLE public.salary_slips
  ADD COLUMN IF NOT EXISTS doctor_id UUID REFERENCES public.doctors(id) ON DELETE CASCADE;

ALTER TABLE public.salary_slips
  DROP CONSTRAINT IF EXISTS salary_slips_clinic_id_staff_id_month_year_key;

ALTER TABLE public.salary_slips
  DROP CONSTRAINT IF EXISTS salary_slips_staff_or_doctor_check;

ALTER TABLE public.salary_slips
  ADD CONSTRAINT salary_slips_staff_or_doctor_check CHECK (
    (staff_id IS NOT NULL AND doctor_id IS NULL)
    OR (staff_id IS NULL AND doctor_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_salary_slips_staff_month
  ON public.salary_slips (clinic_id, staff_id, month_year)
  WHERE staff_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_salary_slips_doctor_month
  ON public.salary_slips (clinic_id, doctor_id, month_year)
  WHERE doctor_id IS NOT NULL;

ALTER TABLE public.salary_entries
  ADD COLUMN IF NOT EXISTS doctor_id UUID REFERENCES public.doctors(id) ON DELETE CASCADE;

ALTER TABLE public.salary_entries
  DROP CONSTRAINT IF EXISTS salary_entries_staff_or_assistant_check;

ALTER TABLE public.salary_entries
  DROP CONSTRAINT IF EXISTS salary_entries_person_check;

ALTER TABLE public.salary_entries
  ADD CONSTRAINT salary_entries_person_check CHECK (
    (staff_id IS NOT NULL AND assistant_id IS NULL AND doctor_id IS NULL)
    OR (staff_id IS NULL AND assistant_id IS NOT NULL AND doctor_id IS NULL)
    OR (staff_id IS NULL AND assistant_id IS NULL AND doctor_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_salary_entries_doctor_date
  ON public.salary_entries (doctor_id, entry_date DESC)
  WHERE doctor_id IS NOT NULL;
