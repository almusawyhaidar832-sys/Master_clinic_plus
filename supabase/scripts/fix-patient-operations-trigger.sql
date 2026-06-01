-- Fix: "record new has no field doctor_share" trigger error
-- Run ALL of this in Supabase SQL Editor

-- ============================================================
-- STEP 1: Drop any conflicting triggers on patient_operations
-- ============================================================
DROP TRIGGER IF EXISTS trg_calculate_operation_shares ON public.patient_operations;
DROP TRIGGER IF EXISTS trg_calc_shares ON public.patient_operations;
DROP TRIGGER IF EXISTS calculate_shares ON public.patient_operations;
DROP TRIGGER IF EXISTS trg_doctor_share ON public.patient_operations;
DROP TRIGGER IF EXISTS set_doctor_share ON public.patient_operations;
DROP TRIGGER IF EXISTS trg_apply_review_fee ON public.patient_operations;

-- Drop old trigger functions too
DROP FUNCTION IF EXISTS public.calculate_operation_shares() CASCADE;
DROP FUNCTION IF EXISTS public.apply_review_fee() CASCADE;

-- ============================================================
-- STEP 2: Ensure all required columns exist
-- ============================================================
ALTER TABLE public.patient_operations
  ADD COLUMN IF NOT EXISTS operation_type      TEXT,
  ADD COLUMN IF NOT EXISTS operation_name_ar   TEXT,
  ADD COLUMN IF NOT EXISTS notes               TEXT,
  ADD COLUMN IF NOT EXISTS is_review_statement BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS materials_cost      DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS doctor_share_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clinic_share_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_debt      DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS operation_date      DATE NOT NULL DEFAULT CURRENT_DATE;

-- ============================================================
-- STEP 3: Create the correct trigger (uses correct column names)
-- ============================================================
CREATE OR REPLACE FUNCTION public.calculate_operation_shares()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  doc_pct   NUMERIC := 0.5;
  mat_share NUMERIC := 0;
  doc_gross NUMERIC;
BEGIN
  -- Get doctor's percentage agreement
  SELECT
    (d.percentage::TEXT)::NUMERIC / 100,
    (d.materials_share::TEXT)::NUMERIC / 100
  INTO doc_pct, mat_share
  FROM public.doctors d
  WHERE d.id = NEW.doctor_id;

  -- Calculate shares
  doc_gross                := NEW.total_amount * doc_pct;
  NEW.doctor_share_amount  := doc_gross - (COALESCE(NEW.materials_cost, 0) * mat_share);
  NEW.clinic_share_amount  := NEW.total_amount - NEW.doctor_share_amount;
  NEW.remaining_debt       := GREATEST(0, NEW.total_amount - NEW.paid_amount);

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_calculate_operation_shares
  BEFORE INSERT OR UPDATE ON public.patient_operations
  FOR EACH ROW EXECUTE FUNCTION public.calculate_operation_shares();

-- ============================================================
-- STEP 4: Reload PostgREST schema cache
-- ============================================================
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- STEP 5: Verify (should return columns list)
-- ============================================================
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'patient_operations'
ORDER BY ordinal_position;
