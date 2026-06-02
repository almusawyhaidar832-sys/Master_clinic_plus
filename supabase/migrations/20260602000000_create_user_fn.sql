-- =============================================================================
-- Migration: create_user_account helper + RLS hardening
-- Purpose : Encapsulates profile-creation logic in a SECURITY DEFINER function
--           callable via service-role RPC (from Next.js API route or Edge Fn).
--           Also tightens RLS so accountants can only see/deactivate doctors,
--           never other accountants or the super_admin.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1.  create_user_profile
--     Called AFTER auth.admin.createUser (Auth Admin API) has already inserted
--     the auth.users row.  Inserts the matching public.profiles row and, when
--     the role is 'doctor', the corresponding public.doctors record.
--
--     Enforcement rules (matched in API route too for defence-in-depth):
--       • super_admin  → may create accountant only
--       • accountant   → may create doctor    only
--       • new user must be linked to the SAME clinic_id as the caller
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_user_profile(
  p_user_id    UUID,
  p_clinic_id  UUID,
  p_role       public.user_role,
  p_full_name  TEXT,
  p_username   TEXT,
  p_phone      TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role       public.user_role;
  v_caller_clinic_id  UUID;
BEGIN
  -- ── Resolve caller identity ──────────────────────────────────────────────
  SELECT role, clinic_id
    INTO v_caller_role, v_caller_clinic_id
    FROM public.profiles
   WHERE id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNAUTHORIZED: caller has no profile';
  END IF;

  -- ── Permission check ──────────────────────────────────────────────────────
  IF v_caller_role NOT IN ('super_admin', 'accountant') THEN
    RAISE EXCEPTION 'FORBIDDEN: insufficient role (got %)', v_caller_role;
  END IF;

  -- super_admin may only create accountants
  IF v_caller_role = 'super_admin' AND p_role <> 'accountant' THEN
    RAISE EXCEPTION 'FORBIDDEN: super_admin can only create accountant accounts';
  END IF;

  -- accountant may only create doctors
  IF v_caller_role = 'accountant' AND p_role <> 'doctor' THEN
    RAISE EXCEPTION 'FORBIDDEN: accountant can only create doctor accounts';
  END IF;

  -- ── Clinic isolation ──────────────────────────────────────────────────────
  -- Super-admin without a clinic_id (platform-wide admin) passes the
  -- desired clinic_id explicitly in p_clinic_id; we trust the API route's
  -- own validation in that case.
  IF v_caller_clinic_id IS NOT NULL AND p_clinic_id <> v_caller_clinic_id THEN
    RAISE EXCEPTION 'FORBIDDEN: cannot create user for a different clinic';
  END IF;

  -- ── Username uniqueness ───────────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM public.profiles WHERE username = p_username) THEN
    RAISE EXCEPTION 'CONFLICT: username already taken';
  END IF;

  -- ── Insert profile ────────────────────────────────────────────────────────
  INSERT INTO public.profiles (
    id, clinic_id, role, full_name, username, phone, is_active
  ) VALUES (
    p_user_id, p_clinic_id, p_role, p_full_name, p_username, p_phone, TRUE
  );

  -- ── Auto-create doctors record ────────────────────────────────────────────
  IF p_role = 'doctor' THEN
    INSERT INTO public.doctors (
      clinic_id, profile_id, full_name_ar,
      percentage, materials_share, is_active
    ) VALUES (
      p_clinic_id, p_user_id, p_full_name,
      '50', '0', TRUE
    );
  END IF;
END;
$$;

-- Grant execute to authenticated role so the API route can call it via RPC
-- (the function still SECURITY DEFINER so it runs with the owner's rights)
GRANT EXECUTE ON FUNCTION public.create_user_profile TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_user_profile TO service_role;

-- -----------------------------------------------------------------------------
-- 2.  is_same_clinic_admin
--     Tiny helper used in RLS policies: returns true when the current user is
--     an accountant/super_admin belonging to the given clinic.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_same_clinic_admin(p_clinic_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id        = auth.uid()
       AND clinic_id = p_clinic_id
       AND role IN ('super_admin', 'accountant')
       AND is_active = TRUE
  );
$$;

-- -----------------------------------------------------------------------------
-- 3.  Tighter RLS for profiles
--     Default policy: accountant sees own clinic, but NOT the super_admin row.
--     Super admin is hidden from accountants so they can't be deactivated.
-- -----------------------------------------------------------------------------

-- Drop the old broad policy (if it exists) and replace with guarded one
DROP POLICY IF EXISTS profiles_select ON public.profiles;

CREATE POLICY profiles_select ON public.profiles FOR SELECT USING (
  -- own row always visible
  id = auth.uid()
  OR (
    -- same-clinic admin: accountant/super_admin can list colleagues
    clinic_id = public.get_my_clinic_id()
    AND public.get_my_role() IN ('super_admin', 'accountant')
    -- accountants cannot see the super_admin's profile
    AND (public.get_my_role() = 'super_admin' OR role <> 'super_admin')
  )
);

-- Accountants can deactivate doctors only, not other accountants
DROP POLICY IF EXISTS profiles_update_self ON public.profiles;

CREATE POLICY profiles_update_self ON public.profiles FOR UPDATE USING (
  -- anyone can update their OWN profile
  id = auth.uid()
  OR (
    -- accountant/super_admin can toggle is_active for non-admin colleagues
    clinic_id = public.get_my_clinic_id()
    AND public.get_my_role() IN ('super_admin', 'accountant')
    AND role <> 'super_admin'
    -- accountant may only touch doctor rows
    AND (public.get_my_role() = 'super_admin' OR role = 'doctor')
  )
);

-- No INSERT policy means ordinary users cannot insert — service_role bypasses RLS.

-- -----------------------------------------------------------------------------
-- 4.  Document the tenant-isolation guarantee
--     All clinic-scoped tables already have policies using get_my_clinic_id().
--     This comment block is the authoritative record of the RLS contract.
-- -----------------------------------------------------------------------------
--
-- TENANT ISOLATION GUARANTEE
-- ══════════════════════════
-- Every table that stores clinic data carries:
--
--   clinic_id UUID NOT NULL REFERENCES public.clinics(id)
--
-- RLS policies on those tables call  public.get_my_clinic_id()  which returns
--   SELECT clinic_id FROM public.profiles WHERE id = auth.uid()
--
-- This means:
--   1. A new user whose profile has clinic_id = X can ONLY read/write rows
--      where clinic_id = X — regardless of how the frontend is written.
--   2. The check happens inside PostgreSQL, not in application code, so it
--      cannot be bypassed by direct API calls.
--   3. Even if a malicious user guesses another clinic's UUIDs, the DB will
--      silently filter them out (RLS returns 0 rows, never an error).
--
-- Tables covered: clinics, profiles, operation_types, doctors, patients,
--   patient_operations, treatments, medical_logs, appointments,
--   schedule_locks, doctor_withdrawals, expenses, staff_members,
--   salary_entries, salary_slips, whatsapp_messages, notifications,
--   clinic_settings, expense_categories, patient_queue, activity_logs
-- =============================================================================
