-- Allow clinic staff to update their tenant branding profile
CREATE POLICY clinics_update_own ON public.clinics FOR UPDATE
USING (
  id = public.get_my_clinic_id()
  AND public.get_my_role() IN ('accountant', 'super_admin')
);
