-- عزل العيادات — شغّل في Supabase SQL Editor إذا تظهر بيانات عيادات أخرى
-- آمن لإعادة التشغيل

-- 1) RLS لحالات العلاج (إن لم تُطبَّق migration)
ALTER TABLE public.patient_treatment_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_treatment_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_treatment_cases_tenant ON public.patient_treatment_cases;
CREATE POLICY patient_treatment_cases_tenant ON public.patient_treatment_cases
  FOR ALL
  USING (public.tenant_can_access(clinic_id))
  WITH CHECK (public.tenant_can_access(clinic_id));

DROP POLICY IF EXISTS patient_treatment_plans_tenant ON public.patient_treatment_plans;
CREATE POLICY patient_treatment_plans_tenant ON public.patient_treatment_plans
  FOR ALL
  USING (public.tenant_can_access(clinic_id))
  WITH CHECK (public.tenant_can_access(clinic_id));

-- 2) تأكيد tenant_can_access (بدون bypass)
CREATE OR REPLACE FUNCTION public.tenant_can_access(p_clinic_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_clinic_id IS NOT NULL
     AND p_clinic_id = public.get_my_clinic_id();
$$;

NOTIFY pgrst, 'reload schema';

-- 3) عرض الملفات المربوطة بعيادات — للمراجعة اليدوية:
-- SELECT p.id, p.username, p.full_name, p.role, p.clinic_id, c.name_ar
-- FROM profiles p
-- LEFT JOIN clinics c ON c.id = p.clinic_id
-- ORDER BY p.created_at DESC;
