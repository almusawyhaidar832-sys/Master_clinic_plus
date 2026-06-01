-- Fix: doctors & staff_members RLS — split ALL into explicit INSERT/UPDATE/DELETE
-- Root cause: ALL policy with USING-only fails on INSERT when clinic_id is null
-- Solution: use tenant_can_access() + WITH CHECK for INSERT

-- =============================================================================
-- DOCTORS
-- =============================================================================
DROP POLICY IF EXISTS doctors_mutate ON public.doctors;
DROP POLICY IF EXISTS doctors_select ON public.doctors;

CREATE POLICY doctors_select ON public.doctors
  FOR SELECT
  USING (public.tenant_can_access(clinic_id));

CREATE POLICY doctors_insert ON public.doctors
  FOR INSERT
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

CREATE POLICY doctors_update ON public.doctors
  FOR UPDATE
  USING (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  )
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

CREATE POLICY doctors_delete ON public.doctors
  FOR DELETE
  USING (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

-- =============================================================================
-- STAFF MEMBERS
-- =============================================================================
DROP POLICY IF EXISTS staff_all ON public.staff_members;
DROP POLICY IF EXISTS staff_select ON public.staff_members;

CREATE POLICY staff_select ON public.staff_members
  FOR SELECT
  USING (public.tenant_can_access(clinic_id));

CREATE POLICY staff_insert ON public.staff_members
  FOR INSERT
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

CREATE POLICY staff_update ON public.staff_members
  FOR UPDATE
  USING (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  )
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

CREATE POLICY staff_delete ON public.staff_members
  FOR DELETE
  USING (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

-- =============================================================================
-- APPOINTMENTS — same pattern fix (was USING-only ALL)
-- =============================================================================
DROP POLICY IF EXISTS appointments_all ON public.appointments;

CREATE POLICY appointments_select ON public.appointments
  FOR SELECT USING (public.tenant_can_access(clinic_id));

CREATE POLICY appointments_insert ON public.appointments
  FOR INSERT
  WITH CHECK (public.tenant_can_access(clinic_id));

CREATE POLICY appointments_update ON public.appointments
  FOR UPDATE
  USING (public.tenant_can_access(clinic_id))
  WITH CHECK (public.tenant_can_access(clinic_id));

CREATE POLICY appointments_delete ON public.appointments
  FOR DELETE USING (public.tenant_can_access(clinic_id));

-- =============================================================================
-- EXPENSES — fix already done in 20260525000000 but double-check
-- =============================================================================
DROP POLICY IF EXISTS expenses_all ON public.expenses;

CREATE POLICY expenses_select ON public.expenses
  FOR SELECT USING (public.tenant_can_access(clinic_id));

CREATE POLICY expenses_insert ON public.expenses
  FOR INSERT
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

CREATE POLICY expenses_update ON public.expenses
  FOR UPDATE
  USING (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  )
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

CREATE POLICY expenses_delete ON public.expenses
  FOR DELETE
  USING (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

-- =============================================================================
-- TRANSACTIONS table (if present in this DB) — basic tenant isolation
-- =============================================================================
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'transactions'
  ) THEN
    EXECUTE 'ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY';

    EXECUTE $p$
      DROP POLICY IF EXISTS transactions_tenant ON public.transactions;
      CREATE POLICY transactions_tenant ON public.transactions
        FOR ALL
        USING (public.tenant_can_access(clinic_id))
        WITH CHECK (public.tenant_can_access(clinic_id))
    $p$;
  END IF;
END $$;

-- =============================================================================
-- HELPER: ensure user profile is linked to a clinic
-- Run this in SQL Editor after signing up:
--   SELECT public.link_profile_to_first_clinic();
-- =============================================================================
CREATE OR REPLACE FUNCTION public.link_profile_to_first_clinic()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic_id UUID;
  v_current UUID;
BEGIN
  SELECT clinic_id INTO v_current
  FROM public.profiles WHERE id = auth.uid();

  IF v_current IS NOT NULL THEN
    RETURN 'already_linked:' || v_current;
  END IF;

  SELECT id INTO v_clinic_id FROM public.clinics ORDER BY created_at LIMIT 1;

  IF v_clinic_id IS NULL THEN
    RETURN 'no_clinic_found';
  END IF;

  UPDATE public.profiles
  SET clinic_id = v_clinic_id, role = COALESCE(role, 'accountant')
  WHERE id = auth.uid();

  RETURN 'linked:' || v_clinic_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_profile_to_first_clinic() TO authenticated;
