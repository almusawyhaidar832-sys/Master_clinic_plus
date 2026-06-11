-- وصفات ذكية — مرتبطة بجلسة الكشف (operation / queue)

CREATE TABLE IF NOT EXISTS public.patient_prescriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  operation_id UUID REFERENCES public.patient_operations(id) ON DELETE CASCADE,
  queue_entry_id UUID REFERENCES public.patient_queue(id) ON DELETE SET NULL,
  prescription_date DATE NOT NULL DEFAULT CURRENT_DATE,
  diagnosis_ar TEXT,
  notes_ar TEXT,
  medications JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'finalized',
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  printed_at TIMESTAMPTZ,
  printed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT patient_prescriptions_status_check
    CHECK (status IN ('draft', 'finalized', 'printed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_prescriptions_operation
  ON public.patient_prescriptions (operation_id)
  WHERE operation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patient_prescriptions_clinic_date
  ON public.patient_prescriptions (clinic_id, prescription_date DESC);

CREATE INDEX IF NOT EXISTS idx_patient_prescriptions_queue
  ON public.patient_prescriptions (queue_entry_id)
  WHERE queue_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patient_prescriptions_patient
  ON public.patient_prescriptions (patient_id);

ALTER TABLE public.patient_prescriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_prescriptions_tenant ON public.patient_prescriptions;
CREATE POLICY patient_prescriptions_tenant ON public.patient_prescriptions
  FOR ALL
  USING (public.tenant_can_access(clinic_id))
  WITH CHECK (public.tenant_can_access(clinic_id));

COMMENT ON TABLE public.patient_prescriptions IS
  'وصفة طبية لجلسة كشف — يكتبها الطبيب ويطبعها المحاسب';

NOTIFY pgrst, 'reload schema';
