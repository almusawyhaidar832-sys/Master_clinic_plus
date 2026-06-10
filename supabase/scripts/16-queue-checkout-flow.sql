-- مرحلة الحساب النهائي — شغّله في Supabase SQL Editor
-- يضيف ready_for_payment لحالة الطابور والمواعيد

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'queue_status' AND e.enumlabel = 'ready_for_payment'
  ) THEN
    ALTER TYPE public.queue_status ADD VALUE 'ready_for_payment';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'appointment_status' AND e.enumlabel = 'ready_for_payment'
  ) THEN
    ALTER TYPE public.appointment_status ADD VALUE 'ready_for_payment';
  END IF;
END $$;

SELECT enumlabel AS queue_status
FROM pg_enum e
JOIN pg_type t ON e.enumtypid = t.oid
WHERE t.typname = 'queue_status'
ORDER BY enumsortorder;
