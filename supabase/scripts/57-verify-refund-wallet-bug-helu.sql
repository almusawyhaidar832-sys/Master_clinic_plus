-- =============================================================================
-- تأكيد سبب فرق رصيد الموبايل — عيادة الحلو (حارث/سجاد)
-- شغّله في Supabase → SQL Editor
--
-- السبب المكتشف:
--   محفظة الطبيب بالموبايل (src/lib/services/doctor-wallet.ts) كانت تتجاهل
--   عمليات «الإرجاع» (session_kind='refund') لأن paid_amount فيها سالب،
--   فالخصم المفروض ينزل من رصيد الطبيب ما كان يُطرح أبداً بالموبايل.
--   تم إصلاح هذا بالكود (calcOperationEarned) — هذا السكربت يوضح المقدار فقط.
-- =============================================================================

DROP TABLE IF EXISTS _helu_clinic2;
CREATE TEMP TABLE _helu_clinic2 AS
SELECT c.id, c.name_ar
FROM public.clinics c
WHERE c.name_ar ILIKE '%الحلو%';

SELECT id, name_ar FROM _helu_clinic2;

DROP TABLE IF EXISTS _helu_doc2;
CREATE TEMP TABLE _helu_doc2 AS
SELECT d.id, d.full_name_ar, d.percentage, d.payment_type
FROM public.doctors d
JOIN _helu_clinic2 c ON c.id = d.clinic_id
WHERE d.full_name_ar ILIKE '%سجاد%' OR d.full_name_ar ILIKE '%حارث%';

SELECT id, full_name_ar, percentage, payment_type FROM _helu_doc2;


-- ═══════════════════════════════════════════════════════════════════════════
-- 1) كل عمليات الإرجاع لحارث وسجاد — هذا المبلغ كان «ضايع» من حساب الموبايل
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  d.full_name_ar AS doctor_name,
  po.operation_date,
  pat.full_name_ar AS patient_name,
  po.paid_amount AS refund_paid_amount,
  po.doctor_share_amount AS refund_doctor_share,
  po.notes,
  po.id AS operation_id
FROM public.patient_operations po
JOIN _helu_doc2 d ON d.id = po.doctor_id
JOIN public.patients pat ON pat.id = po.patient_id
WHERE po.session_kind = 'refund'
ORDER BY d.full_name_ar, po.operation_date;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2) ملخص — مجموع الإرجاعات لكل طبيب (هذا تقريباً الفرق بين الموبايل والصحيح)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  d.full_name_ar AS doctor_name,
  COUNT(po.id) AS refund_count,
  ROUND(COALESCE(SUM(ABS(po.doctor_share_amount)), 0)::numeric, 2) AS total_doctor_share_refunded,
  (public.get_doctor_wallet_stats(d.id) ->> 'available_balance')::numeric AS balance_sql_rpc,
  ROUND((
    (public.get_doctor_wallet_stats(d.id) ->> 'available_balance')::numeric
    + COALESCE(SUM(ABS(po.doctor_share_amount)), 0)
  )::numeric, 2) AS balance_if_refund_ignored_like_mobile_bug
FROM _helu_doc2 d
LEFT JOIN public.patient_operations po
  ON po.doctor_id = d.id AND po.session_kind = 'refund'
GROUP BY d.id, d.full_name_ar
ORDER BY d.full_name_ar;

-- ملاحظة: عمود balance_if_refund_ignored_like_mobile_bug يجب أن يقارب
-- الرقم اللي كان يظهر بالموبايل قبل الإصلاح (مثلاً 48,500 لحارث).
-- بعد نشر إصلاح doctor-wallet.ts، رقم الموبايل يرجع يطابق balance_sql_rpc.
