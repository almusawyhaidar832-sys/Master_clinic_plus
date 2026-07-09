-- =============================================================================
-- حذف شحنات رصيد العيادة التجريبية "الشبح" (clinic_id = NULL) — حاول
-- المستخدم حذفها من الواجهة لكن ميزة الحذف تفلتر بـ clinic_id فما شافتها
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 0) معاينة قبل الحذف
-- ═══════════════════════════════════════════════════════════════════════════
SELECT id, type, amount, transaction_date, description_ar, created_at
FROM public.transactions
WHERE clinic_id IS NULL
  AND type IN ('balance_topup_clinic', 'balance_topup_doctor')
ORDER BY created_at;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) الحذف الفعلي
-- ═══════════════════════════════════════════════════════════════════════════
DELETE FROM public.transactions
WHERE clinic_id IS NULL
  AND type IN ('balance_topup_clinic', 'balance_topup_doctor');

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) تحقّق
-- ═══════════════════════════════════════════════════════════════════════════
SELECT type, COUNT(*) AS remaining_null
FROM public.transactions
WHERE clinic_id IS NULL
GROUP BY type
ORDER BY remaining_null DESC;
