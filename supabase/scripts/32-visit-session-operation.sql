-- ربط جلسة الكشف بدور الانتظار — شغّله في Supabase SQL Editor

ALTER TABLE public.patient_operations
  ADD COLUMN IF NOT EXISTS queue_entry_id UUID REFERENCES public.patient_queue(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_patient_operations_queue_entry
  ON public.patient_operations (queue_entry_id)
  WHERE queue_entry_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_operations_queue_entry
  ON public.patient_operations (queue_entry_id)
  WHERE queue_entry_id IS NOT NULL;
