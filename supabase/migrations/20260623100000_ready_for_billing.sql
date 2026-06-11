-- مرحلة إرسال الجلسة للمحاسبة: ready_for_billing في الطابور والمواعيد

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'queue_status' AND e.enumlabel = 'ready_for_billing'
  ) THEN
    ALTER TYPE public.queue_status ADD VALUE 'ready_for_billing';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'appointment_status' AND e.enumlabel = 'ready_for_billing'
  ) THEN
    ALTER TYPE public.appointment_status ADD VALUE 'ready_for_billing';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
