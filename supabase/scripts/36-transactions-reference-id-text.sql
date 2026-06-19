-- تأكيد/إلغاء الصرف الجزئي — reference_id نصي (slip_id:timestamp)
-- شغّل في Supabase SQL Editor

DROP INDEX IF EXISTS public.transactions_reference_unique;
DROP INDEX IF EXISTS public.idx_transactions_clinic_ref;

ALTER TABLE public.transactions
  ALTER COLUMN reference_id TYPE TEXT USING reference_id::text;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_reference_unique
  ON public.transactions(clinic_id, reference_type, reference_id)
  WHERE reference_id IS NOT NULL;

COMMENT ON COLUMN public.transactions.reference_id IS
  'مرجع الحركة — UUID أو slip_id:timestamp لتأكيدات جزئية متعددة';

NOTIFY pgrst, 'reload schema';
