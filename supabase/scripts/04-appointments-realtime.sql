-- Run 2 — بعد نجاح 03-add-in-examination-status.sql

ALTER TABLE public.appointments REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

SELECT 'appointments realtime enabled' AS status;
