-- حالة السن البصرية في سجل الجلسة (مثل مخطط المريض)

ALTER TABLE public.operation_tooth_records
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'healthy';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'operation_tooth_records_status_check'
  ) THEN
    ALTER TABLE public.operation_tooth_records
      ADD CONSTRAINT operation_tooth_records_status_check
      CHECK (
        status IN (
          'healthy', 'caries', 'filled', 'crowned',
          'missing', 'root_canal', 'implant'
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN public.operation_tooth_records.status IS
  'الحالة البصرية للسن في مخطط الجلسة — تسوس، محشو، تاج، إلخ';

NOTIFY pgrst, 'reload schema';
