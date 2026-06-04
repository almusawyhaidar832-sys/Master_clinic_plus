-- Multi-tenant: تعزيز عزل البيانات حسب clinic_id

-- 1) whatsapp_messages — نفس منطق tenant_can_access
DROP POLICY IF EXISTS whatsapp_all ON public.whatsapp_messages;

CREATE POLICY whatsapp_tenant_select ON public.whatsapp_messages
  FOR SELECT USING (public.tenant_can_access(clinic_id));

CREATE POLICY whatsapp_tenant_insert ON public.whatsapp_messages
  FOR INSERT WITH CHECK (public.tenant_can_access(clinic_id));

CREATE POLICY whatsapp_tenant_update ON public.whatsapp_messages
  FOR UPDATE
  USING (public.tenant_can_access(clinic_id))
  WITH CHECK (public.tenant_can_access(clinic_id));

-- 2) تأكيد أن get_my_clinic_id يأتي من الملف الشخصي فقط
CREATE OR REPLACE FUNCTION public.get_my_clinic_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT clinic_id FROM public.profiles WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION public.tenant_can_access IS
  'Multi-tenant: true only when row.clinic_id matches profiles.clinic_id of auth.uid()';
