-- إصلاح سريع — إذا فشل السكربت الكامل بسبب transaction_date
-- انسخ هذا الملف فقط والصقه في Supabase SQL Editor ثم Run

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS transaction_date DATE NOT NULL DEFAULT CURRENT_DATE;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS reference_type TEXT;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS reference_id UUID;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id) ON DELETE CASCADE;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS doctor_id UUID REFERENCES public.doctors(id) ON DELETE SET NULL;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES public.patients(id) ON DELETE SET NULL;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS operation_id UUID REFERENCES public.patient_operations(id) ON DELETE SET NULL;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS amount DECIMAL(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'general';

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS description_ar TEXT;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.transactions
SET transaction_date = created_at::date
WHERE transaction_date IS NULL
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions'
      AND column_name = 'created_at'
  );

CREATE UNIQUE INDEX IF NOT EXISTS transactions_reference_unique
  ON public.transactions(clinic_id, reference_type, reference_id)
  WHERE reference_id IS NOT NULL;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'transactions'
ORDER BY ordinal_position;
