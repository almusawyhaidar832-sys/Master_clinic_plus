-- غرفة الانتظار — Realtime + عمود إرسال للطبيب
-- شغّل هذا في Supabase SQL Editor

ALTER TABLE public.patient_queue
  ADD COLUMN IF NOT EXISTS sent_to_doctor_at TIMESTAMPTZ;

ALTER TABLE public.patient_queue REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.patient_queue;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;
