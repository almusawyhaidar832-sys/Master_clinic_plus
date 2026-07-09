-- حذف كل شحنات رصيد العيادة لهذا الشهر + سجل المراقبة
-- استبدل CLINIC_ID بمعرّف عيادة الحلو

-- SELECT id, amount, transaction_date, created_at
-- FROM public.transactions
-- WHERE clinic_id = 'CLINIC_ID'::uuid
--   AND type = 'balance_topup_clinic'
-- ORDER BY created_at DESC;

BEGIN;

DELETE FROM public.audit_logs
WHERE clinic_id = 'CLINIC_ID'::uuid
  AND entity_type = 'financial_transaction'
  AND (
    after_data->>'type' = 'balance_topup_clinic'
    OR note ILIKE '%شحن رصيد العيادة%'
  );

DELETE FROM public.transactions
WHERE clinic_id = 'CLINIC_ID'::uuid
  AND type = 'balance_topup_clinic';

COMMIT;
