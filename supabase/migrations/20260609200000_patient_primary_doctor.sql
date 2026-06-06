-- تحويل المراجع بين الأطباء: الطبيب المعالج للجلسات الجديدة (الجلسات القديمة لا تُعدَّل)

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS primary_doctor_id UUID REFERENCES public.doctors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_patients_primary_doctor
  ON public.patients (primary_doctor_id)
  WHERE primary_doctor_id IS NOT NULL;

COMMENT ON COLUMN public.patients.primary_doctor_id IS
  'الطبيب المعالج الحالي — يُطبَّق على الجلسات الجديدة فقط؛ الجلسات السابقة تحتفظ بـ patient_operations.doctor_id';

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

-- تعبئة أولية من آخر جلسة لكل مريض
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

ALTER TABLE public.patient_doctor_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY patient_doctor_transfers_select ON public.patient_doctor_transfers
  FOR SELECT USING (public.tenant_can_access(clinic_id));

CREATE POLICY patient_doctor_transfers_insert ON public.patient_doctor_transfers
  FOR INSERT
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

NOTIFY pgrst, 'reload schema';
