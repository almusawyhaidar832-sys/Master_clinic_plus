-- إصلاح / إكمال تحويل الطبيب — آمن للتشغيل أكثر من مرة
-- شغّله إذا فشل السكربت الأول بسبب policy already exists

-- 1) أعمدة المراجع
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS primary_doctor_id UUID REFERENCES public.doctors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_patients_primary_doctor
  ON public.patients (primary_doctor_id)
  WHERE primary_doctor_id IS NOT NULL;

-- 2) جدول سجل التحويلات
CREATE TABLE IF NOT EXISTS public.patient_doctor_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  from_doctor_id UUID REFERENCES public.doctors(id) ON DELETE SET NULL,
  to_doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  transferred_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_doctor_transfers_patient
  ON public.patient_doctor_transfers (patient_id, created_at DESC);

-- 3) تحويل على مستوى الحالة (السكربت الثاني)
ALTER TABLE public.patient_treatment_cases
  ADD COLUMN IF NOT EXISTS primary_doctor_id UUID REFERENCES public.doctors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_treatment_cases_primary_doctor
  ON public.patient_treatment_cases (primary_doctor_id)
  WHERE primary_doctor_id IS NOT NULL;

ALTER TABLE public.patient_doctor_transfers
  ADD COLUMN IF NOT EXISTS treatment_case_id UUID
    REFERENCES public.patient_treatment_cases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_patient_doctor_transfers_case
  ON public.patient_doctor_transfers (treatment_case_id, created_at DESC)
  WHERE treatment_case_id IS NOT NULL;

-- 4) RLS — إعادة إنشاء بدون خطأ «already exists»
ALTER TABLE public.patient_doctor_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_doctor_transfers_select ON public.patient_doctor_transfers;
CREATE POLICY patient_doctor_transfers_select ON public.patient_doctor_transfers
  FOR SELECT USING (public.tenant_can_access(clinic_id));

DROP POLICY IF EXISTS patient_doctor_transfers_insert ON public.patient_doctor_transfers;
CREATE POLICY patient_doctor_transfers_insert ON public.patient_doctor_transfers
  FOR INSERT
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

-- 5) تعبئة أولية (فقط حيث فارغ)
UPDATE public.patients p
SET primary_doctor_id = sub.doctor_id
FROM (
  SELECT DISTINCT ON (po.patient_id)
    po.patient_id,
    po.doctor_id
  FROM public.patient_operations po
  WHERE po.session_kind IS DISTINCT FROM 'refund'
  ORDER BY po.patient_id, po.created_at DESC
) sub
WHERE p.id = sub.patient_id
  AND p.primary_doctor_id IS NULL;

UPDATE public.patient_treatment_cases tc
SET primary_doctor_id = sub.doctor_id
FROM (
  SELECT DISTINCT ON (po.treatment_case_id)
    po.treatment_case_id,
    po.doctor_id
  FROM public.patient_operations po
  WHERE po.treatment_case_id IS NOT NULL
    AND po.session_kind IS DISTINCT FROM 'refund'
  ORDER BY po.treatment_case_id, po.created_at DESC
) sub
WHERE tc.id = sub.treatment_case_id
  AND tc.primary_doctor_id IS NULL;

NOTIFY pgrst, 'reload schema';
