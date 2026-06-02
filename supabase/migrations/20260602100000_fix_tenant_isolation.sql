-- Fix: clinic owners (super_admin WITH clinic_id) must only see their own clinic.
-- Previously is_super_admin() bypassed tenant isolation on many tables.

-- 1) tenant_can_access — clinic-scoped only
CREATE OR REPLACE FUNCTION public.tenant_can_access(p_clinic_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_clinic_id IS NOT NULL
     AND p_clinic_id = public.get_my_clinic_id();
$$;

-- 2) profiles SELECT — same clinic only
DROP POLICY IF EXISTS profiles_select ON public.profiles;

CREATE POLICY profiles_select ON public.profiles FOR SELECT USING (
  id = auth.uid()
  OR (
    clinic_id = public.get_my_clinic_id()
    AND public.get_my_role() IN ('super_admin', 'accountant')
    AND (public.get_my_role() = 'super_admin' OR role <> 'super_admin')
  )
);

-- 3) clinics — owner sees own clinic only (not all clinics)
DROP POLICY IF EXISTS clinic_tenant_select ON public.clinics;
DROP POLICY IF EXISTS super_admin_all_clinics ON public.clinics;

CREATE POLICY clinic_tenant_select ON public.clinics FOR SELECT USING (
  id = public.get_my_clinic_id()
);

CREATE POLICY clinic_tenant_update ON public.clinics FOR UPDATE USING (
  id = public.get_my_clinic_id()
  AND public.get_my_role() IN ('super_admin', 'accountant')
);

-- 4) Remove super_admin bypass from tenant-scoped tables
DROP POLICY IF EXISTS tenant_isolation_select ON public.operation_types;
CREATE POLICY tenant_isolation_select ON public.operation_types FOR SELECT
  USING (public.tenant_can_access(clinic_id));

DROP POLICY IF EXISTS doctors_select ON public.doctors;
CREATE POLICY doctors_select ON public.doctors FOR SELECT
  USING (public.tenant_can_access(clinic_id));
