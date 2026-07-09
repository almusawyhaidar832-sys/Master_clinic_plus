-- =============================================================================
-- تصحيح نهائي لآخر 3 صفوف بلا clinic_id — بدون حذف أي مبلغ حقيقي
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) doctor_expense_clinic لدكتور احمد — نفس clinic_id من أخوه
--    doctor_expense_doctor (نفس reference_id، مصحَّح أصلاً)
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE public.transactions t
SET clinic_id = sib.clinic_id
FROM public.transactions sib
WHERE t.id = '4b222e6f-37a9-49f3-84b5-d28d69ebb742'
  AND sib.reference_id = t.reference_id
  AND sib.type = 'doctor_expense_doctor'
  AND sib.clinic_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) مجموعة 21641ef9 — فصل مرجع الصف الثاني بلاحقة فريدة (يحافظ على المبلغ
--    والتاريخ، فقط يفكّ تعارض المرجع المشترك بالغلط)، ثم تعبئة clinic_id
--    للصفّين من سجل salary_slip نفسه (عبر الحركة الأخت staff_salary_accrual
--    المصحَّحة أصلاً بنفس الـ id الأساسي)
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE public.transactions
SET reference_id = reference_id || ':dup2'
WHERE id = '75fd908d-8da4-4c3c-a68e-0a89f6002023';

UPDATE public.transactions t
SET clinic_id = sib.clinic_id
FROM public.transactions sib
WHERE t.id IN (
    'e97e4e97-8516-4545-9b74-b683d3b18359',
    '75fd908d-8da4-4c3c-a68e-0a89f6002023'
  )
  AND sib.type = 'staff_salary_accrual'
  AND sib.reference_id = '21641ef9-b076-4aab-b01f-54488aa4a4d0'
  AND sib.clinic_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) تحقّق نهائي — المفروض صفر صفوف بلا clinic_id بكل النظام
-- ═══════════════════════════════════════════════════════════════════════════
SELECT COUNT(*) AS total_still_null
FROM public.transactions
WHERE clinic_id IS NULL;
