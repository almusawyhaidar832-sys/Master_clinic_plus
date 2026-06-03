-- Salary tables: split FOR ALL policies (INSERT/UPDATE were failing silently for some roles)

DROP POLICY IF EXISTS salary_entries_all ON public.salary_entries;
DROP POLICY IF EXISTS salary_slips_all ON public.salary_slips;

DROP POLICY IF EXISTS salary_entries_select ON public.salary_entries;
DROP POLICY IF EXISTS salary_entries_insert ON public.salary_entries;
DROP POLICY IF EXISTS salary_entries_update ON public.salary_entries;
DROP POLICY IF EXISTS salary_entries_delete ON public.salary_entries;

DROP POLICY IF EXISTS salary_slips_select ON public.salary_slips;
DROP POLICY IF EXISTS salary_slips_insert ON public.salary_slips;
DROP POLICY IF EXISTS salary_slips_update ON public.salary_slips;
DROP POLICY IF EXISTS salary_slips_delete ON public.salary_slips;

CREATE POLICY salary_entries_select ON public.salary_entries
  FOR SELECT USING (public.tenant_can_access(clinic_id));

CREATE POLICY salary_entries_insert ON public.salary_entries
  FOR INSERT
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

CREATE POLICY salary_entries_update ON public.salary_entries
  FOR UPDATE
  USING (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  )
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

CREATE POLICY salary_entries_delete ON public.salary_entries
  FOR DELETE
  USING (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

CREATE POLICY salary_slips_select ON public.salary_slips
  FOR SELECT USING (public.tenant_can_access(clinic_id));

CREATE POLICY salary_slips_insert ON public.salary_slips
  FOR INSERT
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

CREATE POLICY salary_slips_update ON public.salary_slips
  FOR UPDATE
  USING (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  )
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

CREATE POLICY salary_slips_delete ON public.salary_slips
  FOR DELETE
  USING (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

NOTIFY pgrst, 'reload schema';
