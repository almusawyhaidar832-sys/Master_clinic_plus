-- =============================================================================
-- استعلام واحد فقط — يعطي كل شيء بنتيجة واحدة (بدون تنقّل بين جداول نتائج)
-- =============================================================================
-- شغّل هذا الاستعلام لوحده (فقط هذا، بدون سكربتات أخرى بنفس التبويب) وانسخ
-- كامل الناتج (خصوصاً محتوى الأعمدة wallet / operations_summary /
-- withdrawals_summary / transactions_summary لكل صف).
-- =============================================================================
WITH doc AS (
  SELECT id, full_name_ar
  FROM public.doctors
  WHERE full_name_ar ILIKE '%حارث%' OR full_name_ar ILIKE '%سجاد%'
)
SELECT
  d.full_name_ar,
  public.get_doctor_wallet_stats(d.id) AS wallet,
  (
    SELECT json_build_object(
      'ops_count', COUNT(*),
      'total_paid_amount', COALESCE(SUM(po.paid_amount), 0),
      'total_doctor_share_amount', COALESCE(SUM(po.doctor_share_amount), 0)
    )
    FROM public.patient_operations po
    WHERE po.doctor_id = d.id
  ) AS operations_summary,
  (
    SELECT json_agg(
      json_build_object('status', s.status, 'cnt', s.cnt, 'total', s.total)
    )
    FROM (
      SELECT status, COUNT(*) AS cnt, SUM(amount) AS total
      FROM public.doctor_withdrawals
      WHERE doctor_id = d.id
      GROUP BY status
    ) s
  ) AS withdrawals_summary,
  (
    SELECT json_agg(
      json_build_object(
        'type', t.type, 'cnt', t.cnt, 'net_signed_sum', t.net_signed_sum
      )
    )
    FROM (
      SELECT type, COUNT(*) AS cnt, SUM(amount) AS net_signed_sum
      FROM public.transactions
      WHERE doctor_id = d.id
      GROUP BY type
    ) t
  ) AS transactions_summary
FROM doc d
ORDER BY d.full_name_ar;
