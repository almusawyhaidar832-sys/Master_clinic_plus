-- رقم هاتف المراجع + اختبار واتساب — شغّل في Supabase SQL Editor

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS phone_number TEXT;

UPDATE public.patients
SET phone_number = phone
WHERE phone_number IS NULL AND phone IS NOT NULL;

DO $$
BEGIN
  ALTER TYPE public.whatsapp_message_type ADD VALUE 'test_notification';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
