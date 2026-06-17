-- تشغيل يدوي في Supabase SQL Editor — نسب الطبيب والمختبر من 0% إلى 100%

DO $$
DECLARE
  i int;
BEGIN
  FOR i IN 0..100 LOOP
    EXECUTE format(
      'ALTER TYPE public.doctor_percentage ADD VALUE IF NOT EXISTS %L',
      i::text
    );
    EXECUTE format(
      'ALTER TYPE public.materials_cost_share ADD VALUE IF NOT EXISTS %L',
      i::text
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
