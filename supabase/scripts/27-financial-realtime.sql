-- المرحلة 3: Realtime للحركات المالية — مزامنة محفظة الطبيب والسجل المالي
-- Run in Supabase SQL Editor (no \i)

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.invoices_history;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.doctor_withdrawals;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.doctor_expenses;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

SELECT 'financial realtime enabled' AS status;
