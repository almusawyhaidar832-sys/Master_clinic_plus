-- =============================================================================
-- منع تكرار مشكلة clinic_id = NULL في transactions نهائياً — نسخة يدوية
-- شغّله بعد التأكد أن سكربت 72 رجّع total_still_null = 0
-- =============================================================================

-- تأكيد أخير قبل التقييد
SELECT COUNT(*) AS should_be_zero
FROM public.transactions
WHERE clinic_id IS NULL;

-- القيد الفعلي
ALTER TABLE public.transactions
  ALTER COLUMN clinic_id SET NOT NULL;
