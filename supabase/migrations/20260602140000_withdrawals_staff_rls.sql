-- Allow accountant + super_admin (owner) to approve/reject/pay withdrawals

DROP POLICY IF EXISTS withdrawals_accountant_update ON public.doctor_withdrawals;
DROP POLICY IF EXISTS withdrawals_staff_update ON public.doctor_withdrawals;

CREATE POLICY withdrawals_staff_update ON public.doctor_withdrawals
  FOR UPDATE
  USING (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  )
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

-- Ensure cash insert works without source column requirement
DROP POLICY IF EXISTS withdrawals_accountant_insert ON public.doctor_withdrawals;

CREATE POLICY withdrawals_accountant_insert ON public.doctor_withdrawals
  FOR INSERT
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
    AND status = 'paid'
  );

GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_clinic_id() TO authenticated;

NOTIFY pgrst, 'reload schema';
