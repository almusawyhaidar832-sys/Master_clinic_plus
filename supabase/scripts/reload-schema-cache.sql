-- Run this in Supabase SQL Editor after adding new columns manually
-- Forces PostgREST to re-read the DB schema

NOTIFY pgrst, 'reload schema';

-- Also ensure optional columns exist
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS review_fee_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS review_fee_amount   DECIMAL(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.staff_members
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Force reload again after ALTER
NOTIFY pgrst, 'reload schema';

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'clinics'
ORDER BY ordinal_position;
