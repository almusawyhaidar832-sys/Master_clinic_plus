-- تحويل الطبيب على مستوى الحالة (وليس المراجع كاملاً)

ALTER TABLE public.patient_treatment_cases
  ADD COLUMN IF NOT EXISTS primary_doctor_id UUID REFERENCES public.doctors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_treatment_cases_primary_doctor
  ON public.patient_treatment_cases (primary_doctor_id)
  WHERE primary_doctor_id IS NOT NULL;

COMMENT ON COLUMN public.patient_treatment_cases.primary_doctor_id IS
  'الطبيب المعالج لهذه الحالة — الجلسات الجديدة للحالة فقط؛ الجلسات السابقة لا تُعدَّل';

ALTER TABLE public.patient_doctor_transfers
  ADD COLUMN IF NOT EXISTS treatment_case_id UUID
    REFERENCES public.patient_treatment_cases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_patient_doctor_transfers_case
  ON public.patient_doctor_transfers (treatment_case_id, created_at DESC)
  WHERE treatment_case_id IS NOT NULL;

-- تعبئة من آخر جلسة لكل حالة
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
