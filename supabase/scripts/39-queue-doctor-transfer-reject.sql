-- رفض/تحويل المراجع من الطبيب — نفّذ في Supabase → SQL Editor
-- (نفس migration 20260627100000_queue_doctor_transfer_reject.sql)

ALTER TABLE public.patient_queue
  ADD COLUMN IF NOT EXISTS transfer_to_doctor_id UUID
    REFERENCES public.doctors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transfer_from_doctor_id UUID
    REFERENCES public.doctors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transfer_requested_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_patient_queue_transfer_pending
  ON public.patient_queue (clinic_id, queue_date)
  WHERE transfer_to_doctor_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
