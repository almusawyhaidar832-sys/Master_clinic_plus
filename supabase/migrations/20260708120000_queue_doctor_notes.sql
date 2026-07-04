-- Doctor instructions for accountant when sending session to billing
ALTER TABLE public.patient_queue
  ADD COLUMN IF NOT EXISTS doctor_notes TEXT;

COMMENT ON COLUMN public.patient_queue.notes IS 'Accountant intake note when adding patient to queue';
COMMENT ON COLUMN public.patient_queue.doctor_notes IS 'Doctor instructions for accountant when session is sent to billing';
