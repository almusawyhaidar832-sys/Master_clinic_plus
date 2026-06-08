-- =============================================================================
-- Master Clinic Plus — هيكلية Multi-tenant الجديدة (ملف واحد للتشغيل اليدوي)
-- انسخ محتوى الملف التالي بالكامل والصقه في Supabase SQL Editor:
--
--   supabase/migrations/20260613000000_multi_tenant_new_features.sql
--
-- أو شغّله عبر CLI:
--   supabase db push
-- =============================================================================

-- تحقق سريع بعد التطبيق (شغّله منفصلاً بعد نجاح الـ migration)
SELECT 'clinics' AS tbl, count(*) AS rows FROM public.clinics
UNION ALL
SELECT 'assistants', count(*) FROM public.assistants
UNION ALL
SELECT 'doctor_expenses', count(*) FROM public.doctor_expenses
UNION ALL
SELECT 'invoices', count(*) FROM public.invoices;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'appointments'
  AND column_name IN ('clinic_id', 'assistant_id')
ORDER BY column_name;

SELECT id, name_ar, booking_code AS barcode FROM public.clinics ORDER BY created_at;
