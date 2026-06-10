-- المرحلة 3: فهارس لاستعلامات الزوار والذمة + salary_slips
-- شغّله في Supabase SQL Editor بعد 19-performance-phase2.sql

CREATE INDEX IF NOT EXISTS idx_operations_clinic_created
  ON public.patient_operations(clinic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_treatment_cases_clinic_created
  ON public.patient_treatment_cases(clinic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_patients_clinic_created
  ON public.patients(clinic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_salary_slips_clinic_status
  ON public.salary_slips(clinic_id, status);

CREATE INDEX IF NOT EXISTS idx_payroll_records_clinic_month
  ON public.payroll_records(clinic_id, month_year);

NOTIFY pgrst, 'reload schema';
