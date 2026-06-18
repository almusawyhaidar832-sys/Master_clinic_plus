-- مساعد بأجر يومي متغير + نوع حركة أجر يومي
ALTER TABLE public.assistants
  ADD COLUMN IF NOT EXISTS compensation_mode TEXT NOT NULL DEFAULT 'monthly_fixed';

DO $$ BEGIN
  ALTER TABLE public.assistants
    ADD CONSTRAINT assistants_compensation_mode_check
    CHECK (compensation_mode IN ('monthly_fixed', 'daily_wage'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.assistants.compensation_mode IS
  'monthly_fixed = راتب شهري ثابت | daily_wage = أجر يومي يُجمع شهرياً';

DO $$ BEGIN
  ALTER TYPE public.salary_entry_type ADD VALUE IF NOT EXISTS 'daily_wage';
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN
    RAISE NOTICE 'salary_entry_type enum missing — run prior salary migrations first';
END $$;
