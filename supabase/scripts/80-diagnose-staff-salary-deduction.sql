-- =============================================================================
-- تشخيص: "تأكيد صرف راتب موظف" لا يخصم من ربح العيادة — عيادة الحلو
-- =============================================================================
-- شغّل هذا الاستعلام الوحيد وانسخ الناتج كامل (كل الصفوف تحت كل عمود JSON).
-- =============================================================================

WITH clinic AS (
  SELECT id, name_ar FROM public.clinics WHERE name_ar ILIKE '%حلو%'
)
SELECT
  c.name_ar AS clinic_name,
  -- آخر 10 قسائم رواتب (سواء موظف أو طبيب راتب) — الحالة والمدفوع فعلياً
  (
    SELECT json_agg(row_to_json(s))
    FROM (
      SELECT ss.id, ss.staff_id, ss.doctor_id, ss.month_year, ss.status,
             ss.net_payout, ss.paid_net_payout, ss.paid_at
      FROM public.salary_slips ss
      WHERE ss.clinic_id = c.id
      ORDER BY ss.paid_at DESC NULLS LAST, ss.created_at DESC
      LIMIT 10
    ) s
  ) AS recent_salary_slips,
  -- آخر 10 حركات مالية من نوع رواتب (موظف/طبيب) بهذي العيادة
  (
    SELECT json_agg(row_to_json(t))
    FROM (
      SELECT tx.type, tx.amount, tx.reference_type, tx.reference_id,
             tx.transaction_date, tx.created_at, tx.description_ar
      FROM public.transactions tx
      WHERE tx.clinic_id = c.id
        AND tx.type IN ('staff_salary_paid', 'doctor_salary_paid')
      ORDER BY tx.created_at DESC
      LIMIT 10
    ) t
  ) AS recent_salary_transactions,
  -- لقطة الربح الرسمية للشهر الحالي
  public.get_clinic_financial_snapshot(c.id) AS current_month_snapshot
FROM clinic c;
