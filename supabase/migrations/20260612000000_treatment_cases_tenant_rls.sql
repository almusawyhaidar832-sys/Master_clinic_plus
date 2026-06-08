-- عزل حالات العلاج والخطط المالية حسب clinic_id

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

NOTIFY pgrst, 'reload schema';
