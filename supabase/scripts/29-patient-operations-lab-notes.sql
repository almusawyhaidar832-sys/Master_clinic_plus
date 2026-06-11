-- تشغيل يدوي في Supabase SQL Editor — ملاحظات المختبر للجلسات

ALTER TABLE public.patient_operations
  ADD COLUMN IF NOT EXISTS lab_notes TEXT;

COMMENT ON COLUMN public.patient_operations.lab_notes IS
  'تعليمات وتفاصيل عمل المختبر المرتبطة بالجلسة';

NOTIFY pgrst, 'reload schema';
