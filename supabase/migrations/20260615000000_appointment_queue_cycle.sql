DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'appointment_status' AND e.enumlabel = 'waiting'
  ) THEN
    ALTER TYPE public.appointment_status ADD VALUE 'waiting';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'appointment_status' AND e.enumlabel = 'in_clinic'
  ) THEN
    ALTER TYPE public.appointment_status ADD VALUE 'in_clinic';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_patient_queue_appointment
  ON public.patient_queue(appointment_id)
  WHERE appointment_id IS NOT NULL;
