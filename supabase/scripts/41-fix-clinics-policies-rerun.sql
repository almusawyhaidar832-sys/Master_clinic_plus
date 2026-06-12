-- إصلاح: السكربت توقف عند clinics_platform_insert — أعد تشغيل APPLY_MULTI_TENANT_COMPLETE.sql
-- أو شغّل هذا الملف ثم أكمل من السطر 260 في السكربت الكبير (اختياري)

DROP POLICY IF EXISTS clinics_platform_insert ON public.clinics;
DROP POLICY IF EXISTS clinics_platform_update ON public.clinics;
DROP POLICY IF EXISTS clinics_platform_delete ON public.clinics;

CREATE POLICY clinics_platform_insert ON public.clinics
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

CREATE POLICY clinics_platform_update ON public.clinics
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin() OR id = public.get_my_clinic_id())
  WITH CHECK (public.is_platform_admin() OR id = public.get_my_clinic_id());

CREATE POLICY clinics_platform_delete ON public.clinics
  FOR DELETE TO authenticated
  USING (public.is_platform_admin());
