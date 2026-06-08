-- Fix missing appointments columns for mobile/QR booking
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
  ADD COLUMN IF NOT EXISTS appointment_date DATE;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS start_time TIME;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS end_time TIME;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS patient_name_ar TEXT;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS patient_phone TEXT;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS reason_for_change TEXT;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS whatsapp_sent BOOLEAN NOT NULL DEFAULT false;

UPDATE public.appointments
SET appointment_date = COALESCE(appointment_date, CURRENT_DATE)
WHERE appointment_date IS NULL;

UPDATE public.appointments
SET start_time = COALESCE(start_time, '10:00:00'::time)
WHERE start_time IS NULL;

UPDATE public.appointments
SET end_time = COALESCE(
  end_time,
  start_time + INTERVAL '30 minutes',
  '10:30:00'::time
)
WHERE end_time IS NULL;
