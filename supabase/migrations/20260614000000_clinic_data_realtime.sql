-- Realtime for sessions, refunds, audit logs (global reactive sync)

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.patient_operations;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.session_refunds;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_logs;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
