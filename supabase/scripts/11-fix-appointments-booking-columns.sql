-- إصلاح جدول appointments للحجز من الموبايل / الباركود
-- الخطأ: Could not find the 'end_time' column of 'appointments' in the schema cache
-- شغّله في Supabase → SQL Editor → Run

-- 1) حالة pending للحجز العام
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'appointment_status' AND e.enumlabel = 'pending'
  ) THEN
    ALTER TYPE public.appointment_status ADD VALUE 'pending';
  END IF;
END $$;

-- 2) أعمدة الوقت والحجز (إن ناقصة)
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

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS assistant_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 3) تعبئة القيم الفارغة قبل NOT NULL
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

-- 4) تأكيد NOT NULL حيث يلزم (تخطّى إن الجدول قديم جداً)
DO $$ BEGIN
  ALTER TABLE public.appointments ALTER COLUMN appointment_date SET NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.appointments ALTER COLUMN start_time SET NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.appointments ALTER COLUMN end_time SET NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_appointments_doctor_date
  ON public.appointments(doctor_id, appointment_date);

CREATE INDEX IF NOT EXISTS idx_appointments_clinic_date
  ON public.appointments(clinic_id, appointment_date DESC);

-- 5) تحقق
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'appointments'
  AND column_name IN (
    'appointment_date', 'start_time', 'end_time',
    'patient_name_ar', 'patient_phone', 'status', 'notes'
  )
ORDER BY column_name;
