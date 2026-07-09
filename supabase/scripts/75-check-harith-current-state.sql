-- =============================================================================
-- فحص حالة حارث الحالية بالتفصيل — بعد كل التصحيحات
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) الرصيد الحالي من الدالة الرسمية (كل مكوناته)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT d.full_name_ar, d.percentage, d.payment_type,
       public.get_doctor_wallet_stats(d.id) AS wallet
FROM public.doctors d
WHERE d.full_name_ar ILIKE '%حارث%';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) كل عملياته (patient_operations) — بالترتيب الزمني
-- ═══════════════════════════════════════════════════════════════════════════
SELECT po.operation_date, po.created_at, po.session_kind, po.paid_amount,
       po.doctor_share_amount, po.clinic_share_amount, po.review_fee_amount,
       po.is_review_statement
FROM public.patient_operations po
JOIN public.doctors d ON d.id = po.doctor_id
WHERE d.full_name_ar ILIKE '%حارث%'
ORDER BY po.operation_date, po.created_at;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) كل سحوباته (كل الحالات)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT dw.amount, dw.status, dw.requested_at, dw.processed_at
FROM public.doctor_withdrawals dw
JOIN public.doctors d ON d.id = dw.doctor_id
WHERE d.full_name_ar ILIKE '%حارث%'
ORDER BY dw.requested_at;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) كل حركاته المالية (transactions) — خصومات/إضافات
-- ═══════════════════════════════════════════════════════════════════════════
SELECT t.type, t.amount, t.clinic_id, t.reference_type, t.reference_id,
       t.transaction_date, t.created_at, t.description_ar
FROM public.transactions t
JOIN public.doctors d ON d.id = t.doctor_id
WHERE d.full_name_ar ILIKE '%حارث%'
ORDER BY t.transaction_date, t.created_at;
