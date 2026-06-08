-- إدارة مواعيد مساعد الطبيب: pending + سبب التغيير
-- شغّله في Supabase SQL Editor

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'appointment_status' AND e.enumlabel = 'pending'
  ) THEN
    ALTER TYPE public.appointment_status ADD VALUE 'pending';
  END IF;
END $$;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS reason_for_change TEXT;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS patient_phone TEXT;

COMMENT ON COLUMN public.appointments.reason_for_change IS
  'سبب تعديل أو رفض الموعد — يُرسل للمريض عبر واتساب';
COMMENT ON COLUMN public.appointments.patient_phone IS
  'هاتف المريض لإشعارات واتساب';

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS whatsapp_sent BOOLEAN NOT NULL DEFAULT false;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'appointments'
  AND column_name IN ('status', 'reason_for_change', 'patient_phone');
