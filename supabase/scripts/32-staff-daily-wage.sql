-- يدوي: أجر يومي لموظفي العيادة (staff_members)
ALTER TABLE public.staff_members
  ADD COLUMN IF NOT EXISTS compensation_mode TEXT NOT NULL DEFAULT 'monthly_fixed';

DO $$
BEGIN
  ALTER TABLE public.staff_members
    ADD CONSTRAINT staff_members_compensation_mode_check
    CHECK (compensation_mode IN ('monthly_fixed', 'daily_wage'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.staff_members.compensation_mode IS
  'monthly_fixed = راتب شهري ثابت | daily_wage = أجر يومي يُجمع شهرياً';

SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'staff_members'
  AND column_name = 'compensation_mode';
