-- Queue realtime + send-to-doctor tracking
-- Run in Supabase SQL Editor if migration not applied automatically

ALTER TABLE public.patient_queue
  ADD COLUMN IF NOT EXISTS sent_to_doctor_at TIMESTAMPTZ;

-- Full row data on UPDATE (required for realtime filters / old values)
ALTER TABLE public.patient_queue REPLICA IDENTITY FULL;

-- Enable Supabase Realtime for patient_queue (required for postgres_changes)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.patient_queue;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;
