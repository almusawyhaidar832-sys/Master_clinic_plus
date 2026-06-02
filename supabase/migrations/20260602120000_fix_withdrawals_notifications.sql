-- Fix withdrawals + wallet + notifications (run once in Supabase SQL Editor)

-- 1) Missing columns / types from financial engine migration
DO $$ BEGIN
  CREATE TYPE public.withdrawal_source AS ENUM ('doctor_request', 'accountant_cash');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.doctor_withdrawals
  ADD COLUMN IF NOT EXISTS source public.withdrawal_source NOT NULL DEFAULT 'doctor_request';

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS link_path TEXT;

-- 2) Wallet stats RPC (used by app fallback)
CREATE OR REPLACE FUNCTION public.get_doctor_wallet_stats(p_doctor_id UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic_id UUID;
  v_earned NUMERIC;
  v_paid_out NUMERIC;
  v_pending NUMERIC;
  v_approved NUMERIC;
  v_balance NUMERIC;
BEGIN
  SELECT clinic_id INTO v_clinic_id FROM public.doctors WHERE id = p_doctor_id;
  IF v_clinic_id IS NULL THEN
    RETURN json_build_object('error', 'doctor_not_found');
  END IF;

  SELECT COALESCE(SUM(doctor_share_amount), 0) INTO v_earned
  FROM public.patient_operations WHERE doctor_id = p_doctor_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid_out
  FROM public.doctor_withdrawals
  WHERE doctor_id = p_doctor_id AND status = 'paid';

  SELECT COALESCE(SUM(amount), 0) INTO v_pending
  FROM public.doctor_withdrawals
  WHERE doctor_id = p_doctor_id AND status = 'pending';

  SELECT COALESCE(SUM(amount), 0) INTO v_approved
  FROM public.doctor_withdrawals
  WHERE doctor_id = p_doctor_id AND status = 'approved';

  v_balance := GREATEST(0, v_earned - v_paid_out - v_pending - v_approved);

  RETURN json_build_object(
    'total_earnings', ROUND(v_earned, 2),
    'total_withdrawn', ROUND(v_paid_out, 2),
    'pending_amount', ROUND(v_pending, 2),
    'approved_amount', ROUND(v_approved, 2),
    'available_balance', ROUND(v_balance, 2)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_doctor_wallet_stats(UUID) TO authenticated;

-- 3) Accountant can insert cash withdrawals (client-side fallback)
DROP POLICY IF EXISTS withdrawals_accountant_insert ON public.doctor_withdrawals;
CREATE POLICY withdrawals_accountant_insert ON public.doctor_withdrawals
  FOR INSERT
  WITH CHECK (
    clinic_id = public.get_my_clinic_id()
    AND public.get_my_role() IN ('accountant', 'super_admin')
    AND status = 'paid'
  );

-- 4) Link doctors to login profiles (fixes doctor notifications)
UPDATE public.doctors d
SET profile_id = p.id
FROM public.profiles p
WHERE d.profile_id IS NULL
  AND p.role = 'doctor'
  AND p.clinic_id = d.clinic_id
  AND trim(p.full_name) = trim(d.full_name_ar);

-- 6) Ensure FK for PostgREST joins (optional, for future)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'doctor_withdrawals_doctor_id_fkey'
  ) THEN
    ALTER TABLE public.doctor_withdrawals
      ADD CONSTRAINT doctor_withdrawals_doctor_id_fkey
      FOREIGN KEY (doctor_id) REFERENCES public.doctors(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 7) Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
