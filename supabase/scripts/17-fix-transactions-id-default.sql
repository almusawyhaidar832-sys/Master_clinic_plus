-- إصلاح عمود id في transactions — إذا وُجد الجدول قديماً بدون DEFAULT
-- شغّله في Supabase SQL Editor إذا ظهر: null value in column "id"

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'transactions'
  ) THEN
    ALTER TABLE public.transactions
      ALTER COLUMN id SET DEFAULT gen_random_uuid();

    UPDATE public.transactions
    SET id = gen_random_uuid()
    WHERE id IS NULL;
  END IF;
END $$;

SELECT column_name, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'transactions'
  AND column_name = 'id';
