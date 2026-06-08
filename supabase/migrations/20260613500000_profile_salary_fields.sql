-- رواتب المحاسبين + ربط staff_members بحساب المحاسب

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS base_salary DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS job_title TEXT;

ALTER TABLE public.staff_members
  ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS staff_members_profile_id_unique
  ON public.staff_members(profile_id)
  WHERE profile_id IS NOT NULL;
