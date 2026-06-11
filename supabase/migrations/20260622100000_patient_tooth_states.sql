-- مخطط أسنان تراكمي للمريض (منفصل عن operation_tooth_records لكل جلسة)

CREATE TABLE IF NOT EXISTS public.patient_tooth_states (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  tooth_number SMALLINT NOT NULL CHECK (tooth_number BETWEEN 11 AND 48),
  status TEXT NOT NULL DEFAULT 'healthy',
  procedure_ar TEXT,
  note TEXT,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (patient_id, tooth_number)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'patient_tooth_states_status_check'
  ) THEN
    ALTER TABLE public.patient_tooth_states
      ADD CONSTRAINT patient_tooth_states_status_check
      CHECK (
        status IN (
          'healthy', 'caries', 'filled', 'crowned',
          'missing', 'root_canal', 'implant'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_patient_tooth_states_patient
  ON public.patient_tooth_states(patient_id);

CREATE INDEX IF NOT EXISTS idx_patient_tooth_states_clinic_patient
  ON public.patient_tooth_states(clinic_id, patient_id);

ALTER TABLE public.patient_tooth_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_tooth_states_tenant ON public.patient_tooth_states;
CREATE POLICY patient_tooth_states_tenant ON public.patient_tooth_states
  FOR ALL
  USING (public.tenant_can_access(clinic_id))
  WITH CHECK (public.tenant_can_access(clinic_id));

COMMENT ON TABLE public.patient_tooth_states IS
  'الحالة التراكمية لكل سن (FDI) — مخطط المريض الحالي؛ سجل الجلسات يبقى في operation_tooth_records';

NOTIFY pgrst, 'reload schema';
