-- =============================================================================
-- فحص الحالتين اللي فيهم اختلاف بالمبلغ (ليست تكرار متطابق) قبل أي حذف
-- قراءة فقط
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) salary_slip المرتبط بـ staff_salary_accrual (f19b5df2...) — القيمة
--    الصحيحة الحالية (net_payout) لمعرفة أي صف (600000 أو 550000) يطابقها
-- ═══════════════════════════════════════════════════════════════════════════
SELECT id, staff_id, doctor_id, month_year, net_payout, status,
       paid_net_payout, created_at
FROM public.salary_slips
WHERE id = 'f19b5df2-61cd-4cb6-bda7-eaa27257a8f7';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) salary_slip المرتبط بـ staff_salary_paid (21641ef9...) — لمعرفة هل
--    15000 + 45000 = دفعتين جزئيتين حقيقيتين (paid_net_payout = 60000) أو
--    تكرار بمبلغ مصحَّح
-- ═══════════════════════════════════════════════════════════════════════════
SELECT id, staff_id, doctor_id, month_year, net_payout, status,
       paid_net_payout, paid_at, created_at
FROM public.salary_slips
WHERE id = '21641ef9-b076-4aab-b01f-54488aa4a4d0';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) كل حركات transactions (بكل clinic_id، حتى غير NULL) المرتبطة بنفس
--    المرجعين أعلاه — لنرى الصورة الكاملة
-- ═══════════════════════════════════════════════════════════════════════════
SELECT id, type, amount, clinic_id, reference_type, reference_id,
       transaction_date, description_ar, created_at
FROM public.transactions
WHERE reference_id IN (
  'f19b5df2-61cd-4cb6-bda7-eaa27257a8f7',
  '21641ef9-b076-4aab-b01f-54488aa4a4d0'
)
ORDER BY reference_id, created_at;
