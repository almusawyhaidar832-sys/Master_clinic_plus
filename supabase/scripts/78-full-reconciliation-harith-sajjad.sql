-- =============================================================================
-- تصفير الشك نهائياً: مطابقة كاملة بندًا بندًا لحارث وسجاد
-- =============================================================================
-- هذا السكربت يعطي كل رقم يدخل في معادلة الرصيد بشكل منفصل ومجمّع، حتى تقدر
-- تقارنه يدوياً مع دفترك/ذاكرتك وتحدد بالضبط أي بند غير متوقع.
-- الصيغة: الرصيد = أرباح العمليات - مسحوبات مدفوعة - مسحوبات معتمدة
--                 - خصومات مصاريف - خصومات مساعدين + شحن رصيد
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 0) الرصيد الرسمي الحالي (كل مكوّناته من RPC)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT d.full_name_ar, d.percentage, d.payment_type, d.materials_share,
       public.get_doctor_wallet_stats(d.id) AS wallet
FROM public.doctors d
WHERE d.full_name_ar ILIKE '%حارث%' OR d.full_name_ar ILIKE '%سجاد%'
ORDER BY d.full_name_ar;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) أرباح العمليات — تفصيل كل عملية (paid_amount, doctor_share_amount)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT d.full_name_ar AS doctor_name,
       po.operation_date, po.session_kind, po.paid_amount,
       po.doctor_share_amount, po.clinic_share_amount,
       po.review_fee_amount, po.is_review_statement, po.materials_cost
FROM public.patient_operations po
JOIN public.doctors d ON d.id = po.doctor_id
WHERE d.full_name_ar ILIKE '%حارث%' OR d.full_name_ar ILIKE '%سجاد%'
ORDER BY d.full_name_ar, po.operation_date, po.created_at;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1b) إجمالي أرباح العمليات لكل طبيب (يجب يطابق total_earnings بالقسم 0)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT d.full_name_ar AS doctor_name,
       COUNT(*) AS ops_count,
       SUM(po.paid_amount) AS total_paid_amount,
       SUM(po.doctor_share_amount) AS total_earnings
FROM public.patient_operations po
JOIN public.doctors d ON d.id = po.doctor_id
WHERE d.full_name_ar ILIKE '%حارث%' OR d.full_name_ar ILIKE '%سجاد%'
GROUP BY d.full_name_ar;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) المسحوبات (withdrawals) — تفصيل + إجمالي حسب الحالة
-- ═══════════════════════════════════════════════════════════════════════════
SELECT d.full_name_ar AS doctor_name,
       dw.amount, dw.status, dw.requested_at, dw.processed_at
FROM public.doctor_withdrawals dw
JOIN public.doctors d ON d.id = dw.doctor_id
WHERE d.full_name_ar ILIKE '%حارث%' OR d.full_name_ar ILIKE '%سجاد%'
ORDER BY d.full_name_ar, dw.requested_at;

SELECT d.full_name_ar AS doctor_name, dw.status,
       COUNT(*) AS cnt, SUM(dw.amount) AS total
FROM public.doctor_withdrawals dw
JOIN public.doctors d ON d.id = dw.doctor_id
WHERE d.full_name_ar ILIKE '%حارث%' OR d.full_name_ar ILIKE '%سجاد%'
GROUP BY d.full_name_ar, dw.status
ORDER BY d.full_name_ar, dw.status;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) كل حركات transactions (خصومات/إضافات) — تفصيل + صافي مجمّع حسب النوع
-- ═══════════════════════════════════════════════════════════════════════════
SELECT d.full_name_ar AS doctor_name,
       t.type, t.amount, t.reference_type, t.reference_id,
       t.transaction_date, t.created_at, t.description_ar
FROM public.transactions t
JOIN public.doctors d ON d.id = t.doctor_id
WHERE d.full_name_ar ILIKE '%حارث%' OR d.full_name_ar ILIKE '%سجاد%'
ORDER BY d.full_name_ar, t.transaction_date, t.created_at;

SELECT d.full_name_ar AS doctor_name, t.type,
       COUNT(*) AS cnt,
       SUM(t.amount) AS net_signed_sum,
       GREATEST(0, -SUM(t.amount)) AS if_treated_as_deduction
FROM public.transactions t
JOIN public.doctors d ON d.id = t.doctor_id
WHERE d.full_name_ar ILIKE '%حارث%' OR d.full_name_ar ILIKE '%سجاد%'
GROUP BY d.full_name_ar, t.type
ORDER BY d.full_name_ar, t.type;
