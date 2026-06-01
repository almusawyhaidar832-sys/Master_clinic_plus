-- ============================================================
-- DIAGNOSTIC + FIX: run in Supabase SQL Editor
-- Run each section one at a time
-- ============================================================

-- STEP 1: Check your current auth user + profile
SELECT
  au.id          AS auth_id,
  au.email,
  p.clinic_id,
  p.role,
  p.full_name,
  p.username
FROM auth.users au
LEFT JOIN public.profiles p ON p.id = au.id
ORDER BY au.created_at DESC
LIMIT 10;

-- ============================================================
-- STEP 2: Check what clinics exist
SELECT id, name, name_ar, created_at FROM public.clinics;

-- ============================================================
-- STEP 3: If your profile has clinic_id = NULL, fix it:
-- Replace YOUR_USER_UUID with your actual UUID from STEP 1
-- Replace CLINIC_UUID with the clinic id from STEP 2

-- Option A: auto-link to the first clinic (quick fix)
UPDATE public.profiles
SET
  clinic_id = (SELECT id FROM public.clinics ORDER BY created_at LIMIT 1),
  role = COALESCE(role, 'accountant')
WHERE id = auth.uid();   -- only works inside Supabase SQL editor while logged in

-- Option B: manual link (use when Option A doesn't work)
-- UPDATE public.profiles
-- SET clinic_id = 'CLINIC_UUID', role = 'accountant'
-- WHERE id = 'YOUR_USER_UUID';

-- ============================================================
-- STEP 4: Verify fix
SELECT id, clinic_id, role, full_name FROM public.profiles WHERE id = auth.uid();

-- ============================================================
-- STEP 5: Test RLS — should return doctors list (may be empty)
SELECT * FROM public.doctors LIMIT 5;

-- ============================================================
-- STEP 6: If no clinic exists yet, create one first
-- INSERT INTO public.clinics (name, name_ar)
-- VALUES ('Master Clinic Plus', 'ماستر كلينك بلس')
-- RETURNING id, name;
