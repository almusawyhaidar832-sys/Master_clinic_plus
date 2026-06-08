-- Realtime لجدول appointments (شاشة العمليات المركزية)
-- يتطلب تشغيل 20260613200000_appointment_in_examination_enum.sql أولاً

ALTER TABLE public.appointments REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
