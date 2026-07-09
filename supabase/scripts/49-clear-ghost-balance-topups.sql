-- شحنات رصيد وهمية في audit_logs ترفع الربح رغم حذف transactions
-- الفرق الشائع: +71,000 (مثلاً 1,227,500 بدل 1,156,500)
-- شغّل في Supabase SQL Editor

-- 1) تشخيص — شحنات من transactions
SELECT
  c.name_ar,
  t.id,
  t.amount,
  t.transaction_date,
  t.description_ar,
  t.created_at
FROM public.transactions t
JOIN public.clinics c ON c.id = t.clinic_id
WHERE c.name_ar ILIKE '%الحلو%'
  AND t.type = 'balance_topup_clinic'
  AND t.transaction_date BETWEEN '2026-07-01' AND '2026-07-09'
ORDER BY t.transaction_date DESC;

-- 2) تشخيص — شحنات من audit_logs فقط (مصدر الشبح)
SELECT
  c.name_ar,
  al.id,
  al.financial_amount,
  al.changed_at,
  al.after_data->>'type' AS tx_type,
  al.after_data->>'amount' AS tx_amount,
  al.after_data->>'transaction_date' AS tx_date
FROM public.audit_logs al
JOIN public.clinics c ON c.id = al.clinic_id
WHERE c.name_ar ILIKE '%الحلو%'
  AND al.entity_type = 'financial_transaction'
  AND (
    al.after_data->>'type' = 'balance_topup_clinic'
    OR al.after_data->>'target' = 'clinic'
  )
  AND COALESCE(
    (al.after_data->>'transaction_date')::date,
    al.changed_at::date
  ) BETWEEN '2026-07-01' AND '2026-07-09'
ORDER BY al.changed_at DESC;

-- 3) حذف شحنات audit الوهمية لعيادة الحلو — يوليو 2026
DELETE FROM public.audit_logs al
USING public.clinics c
WHERE al.clinic_id = c.id
  AND c.name_ar ILIKE '%الحلو%'
  AND al.entity_type = 'financial_transaction'
  AND (
    al.after_data->>'type' = 'balance_topup_clinic'
    OR al.after_data->>'target' = 'clinic'
  )
  AND COALESCE(
    (al.after_data->>'transaction_date')::date,
    al.changed_at::date
  ) BETWEEN '2026-07-01' AND '2026-07-09';

-- 4) حذف أي transactions شحن متبقية (إن وُجدت)
DELETE FROM public.transactions t
USING public.clinics c
WHERE t.clinic_id = c.id
  AND c.name_ar ILIKE '%الحلو%'
  AND t.type = 'balance_topup_clinic'
  AND t.transaction_date BETWEEN '2026-07-01' AND '2026-07-09';

-- 5) تحقق — يجب 0 شحنات و net_profit_app_formula = 1,156,500
--    (شغّل تفصيل 10 من 46-accounting-logic-verification.sql)
