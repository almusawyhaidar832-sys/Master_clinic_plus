-- المرحلة 1: السجل التاريخي للفواتير + حالة الأرشفة على الجلسات

ALTER TABLE public.patient_operations
  ADD COLUMN IF NOT EXISTS invoice_status TEXT NOT NULL DEFAULT 'pending';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'patient_operations_invoice_status_check'
  ) THEN
    ALTER TABLE public.patient_operations
      ADD CONSTRAINT patient_operations_invoice_status_check
      CHECK (invoice_status IN ('pending', 'archived'));
  END IF;
END $$;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS invoice_number TEXT;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS finalized_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_status_check'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_status_check
      CHECK (status IN ('draft', 'finalized'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.invoices_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  doctor_id UUID REFERENCES public.doctors(id) ON DELETE SET NULL,
  patient_id UUID REFERENCES public.patients(id) ON DELETE SET NULL,
  operation_id UUID REFERENCES public.patient_operations(id) ON DELETE SET NULL,
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  patient_name_ar TEXT NOT NULL DEFAULT '',
  doctor_name_ar TEXT NOT NULL DEFAULT '',
  procedure_label TEXT NOT NULL DEFAULT '',
  treatment_name TEXT NOT NULL DEFAULT '',
  total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  remaining_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  doctor_share NUMERIC(12, 2) NOT NULL DEFAULT 0,
  clinic_share NUMERIC(12, 2) NOT NULL DEFAULT 0,
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  finalized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_history_operation
  ON public.invoices_history(operation_id)
  WHERE operation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_history_clinic_doctor_date
  ON public.invoices_history(clinic_id, doctor_id, invoice_date DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_history_clinic_date
  ON public.invoices_history(clinic_id, invoice_date DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_history_patient_name
  ON public.invoices_history(clinic_id, patient_name_ar);

COMMENT ON TABLE public.invoices_history IS
  'أرشيف الفواتير المعتمدة نهائياً — للسجل التاريخي في صرفيات الأطباء';

NOTIFY pgrst, 'reload schema';
