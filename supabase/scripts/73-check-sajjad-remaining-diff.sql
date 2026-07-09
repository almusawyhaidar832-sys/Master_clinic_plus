-- =============================================================================
-- فحص فرق سجاد المتبقي (7500) بعد تصحيح clinic_id — قراءة فقط
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) الرصيد الحالي من الدالة الرسمية
-- ═══════════════════════════════════════════════════════════════════════════
SELECT d.full_name_ar, public.get_doctor_wallet_stats(d.id) AS wallet
FROM public.doctors d
WHERE d.full_name_ar ILIKE '%سجاد%';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) كل حركات transactions المؤثرة على محفظته (خصومات/إضافات) الآن بعد
--    تصحيح clinic_id — كلها
-- ═══════════════════════════════════════════════════════════════════════════
SELECT t.type, t.amount, t.clinic_id, t.reference_type, t.reference_id,
       t.transaction_date, t.description_ar
FROM public.transactions t
JOIN public.doctors d ON d.id = t.doctor_id
WHERE d.full_name_ar ILIKE '%سجاد%'
ORDER BY t.transaction_date;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) كل سحوباته (كل الحالات، ليس فقط paid/approved)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT dw.amount, dw.status, dw.requested_at, dw.processed_at
FROM public.doctor_withdrawals dw
JOIN public.doctors d ON d.id = dw.doctor_id
WHERE d.full_name_ar ILIKE '%سجاد%'
ORDER BY dw.requested_at;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) كل عمليات patient_operations له — للتأكد من مجموع doctor_share_amount
-- ═══════════════════════════════════════════════════════════════════════════
SELECT po.operation_date, po.session_kind, po.paid_amount,
       po.doctor_share_amount, po.clinic_share_amount, po.review_fee_amount,
       po.is_review_statement
FROM public.patient_operations po
JOIN public.doctors d ON d.id = po.doctor_id
WHERE d.full_name_ar ILIKE '%سجاد%'
ORDER BY po.operation_date;
