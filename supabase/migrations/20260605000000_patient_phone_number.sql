-- رقم هاتف المراجع (WhatsApp) + نوع رسالة اختبار

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS phone_number TEXT;

COMMENT ON COLUMN public.patients.phone_number IS
  'رقم هاتف المراجع بصيغة دولية (+964...) — مرجع إرسال الواتساب';

UPDATE public.patients
SET phone_number = phone
WHERE phone_number IS NULL AND phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patients_phone_number
  ON public.patients (clinic_id, phone_number)
  WHERE phone_number IS NOT NULL;

DO $$
BEGIN
  ALTER TYPE public.whatsapp_message_type ADD VALUE 'test_notification';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
