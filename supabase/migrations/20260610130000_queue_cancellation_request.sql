-- طلب إلغاء من الطبيب/المساعد — المحاسب يحوّل أو يلغي نهائياً

ALTER TABLE public.patient_queue
  ADD COLUMN IF NOT EXISTS cancellation_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_requested_by UUID
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_actor_label TEXT;

CREATE INDEX IF NOT EXISTS idx_patient_queue_cancellation_pending
  ON public.patient_queue (clinic_id, queue_date)
  WHERE cancellation_requested_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
