-- تصحيح paid_clinic_share_amount لمساعدين عيادة الحلو — يوليو 2026
-- التشخيص أظهر: مجموع paid_clinic = 57,500 بينما المدفوع نقداً = 56,000 → ربح أنقص 1,500
-- لا توجد حركات تأكيد (tx_confirmed_clinic = 0) — التصحيح من البيانات فقط
-- شغّل في Supabase SQL Editor بالترتيب: 1 تشخيص → 2 تصحيح → 3 إعادة حساب → 4 تحقق

-- ═══════════════════════════════════════════════════════════════
-- 1) تشخيص — كل مساعد + حركات التأكيد
-- ═══════════════════════════════════════════════════════════════
SELECT
  c.name_ar AS clinic_name,
  pr.assistant_name_ar,
  pr.month_year,
  pr.status,
  pr.total_salary,
  pr.clinic_share_amount,
  pr.paid_clinic_share_amount,
  pr.paid_doctor_share_amount,
  pr.paid_total_salary,
  COALESCE(tx.confirmed_clinic, 0) AS tx_confirmed_clinic,
  COALESCE(entries.daily_wage_total, 0) AS daily_wage_registered,
  ROUND(
    COALESCE(entries.daily_wage_total, 0)
    * (100 - COALESCE(pr.doctor_share_percentage, 0)) / 100,
    2
  ) AS daily_wage_clinic_share_registered
FROM public.payroll_records pr
JOIN public.clinics c ON c.id = pr.clinic_id
LEFT JOIN LATERAL (
  SELECT ROUND(COALESCE(SUM(ABS(t.amount)), 0)::numeric, 2) AS confirmed_clinic
  FROM public.transactions t
  WHERE t.clinic_id = pr.clinic_id
    AND t.type = 'assistant_payroll_clinic'
    AND (
      t.reference_id = pr.id::text
      OR t.reference_id LIKE pr.id::text || ':%'
      OR t.reference_id IN (
        SELECT se.id::text
        FROM public.salary_entries se
        WHERE se.assistant_id = pr.assistant_id
          AND se.clinic_id = pr.clinic_id
          AND to_char(se.entry_date, 'YYYY-MM') = pr.month_year
      )
    )
) tx ON TRUE
LEFT JOIN LATERAL (
  SELECT ROUND(COALESCE(SUM(se.amount), 0)::numeric, 2) AS daily_wage_total
  FROM public.salary_entries se
  WHERE se.clinic_id = pr.clinic_id
    AND se.assistant_id = pr.assistant_id
    AND se.entry_type = 'daily_wage'
    AND to_char(se.entry_date, 'YYYY-MM') = pr.month_year
) entries ON TRUE
WHERE c.name_ar ILIKE '%الحلو%'
  AND pr.month_year = '2026-07'
ORDER BY pr.assistant_name_ar;

-- ═══════════════════════════════════════════════════════════════
-- 2) تصحيح المدفوع نقداً — حصة العيادة الفعلية (مجموع = 56,000)
--    أديان: 15,000 → 13,500 (كان مضخّماً = total_salary بدل حصة العيادة)
--    حنين: 17,500 (صحيح)
--    يسرى: 25,000 (صحيح)
--    غيّر الأرقام إذا كان المدفوع الفعلي مختلفاً عندك
-- ═══════════════════════════════════════════════════════════════
UPDATE public.payroll_records pr
SET
  paid_clinic_share_amount = v.clinic_paid,
  paid_doctor_share_amount = v.doctor_paid,
  paid_total_salary = v.clinic_paid + v.doctor_paid,
  paid_at = COALESCE(pr.paid_at, NOW())
FROM (
  VALUES
    ('اديان مسلم', 13500::numeric, 13500::numeric),
    ('حنين',         17500::numeric, 17500::numeric),
    ('يسرى',         25000::numeric, 25000::numeric)
) AS v(assistant_name, clinic_paid, doctor_paid)
JOIN public.clinics c ON c.name_ar ILIKE '%الحلو%'
WHERE pr.clinic_id = c.id
  AND pr.month_year = '2026-07'
  AND pr.assistant_name_ar = v.assistant_name;

-- ═══════════════════════════════════════════════════════════════
-- 3) إعادة حساب المستحق من salary_entries + تصحيح الحالة
--    (يمنع status=paid الخاطئ عندما total_salary يعرض المتبقي فقط)
-- ═══════════════════════════════════════════════════════════════
WITH accrued AS (
  SELECT
    pr.id AS record_id,
    ROUND(COALESCE(SUM(se.amount), 0)::numeric, 2) AS full_net,
    ROUND(COALESCE(SUM(
      se.amount * COALESCE(a.doctor_share_percentage, 0) / 100
    ), 0)::numeric, 2) AS full_doctor,
    ROUND(COALESCE(SUM(
      se.amount * (100 - COALESCE(a.doctor_share_percentage, 0)) / 100
    ), 0)::numeric, 2) AS full_clinic
  FROM public.payroll_records pr
  JOIN public.clinics c ON c.id = pr.clinic_id
  JOIN public.assistants a ON a.id = pr.assistant_id
  JOIN public.salary_entries se
    ON se.assistant_id = pr.assistant_id
   AND se.clinic_id = pr.clinic_id
   AND se.entry_type = 'daily_wage'
   AND to_char(se.entry_date, 'YYYY-MM') = pr.month_year
  WHERE c.name_ar ILIKE '%الحلو%'
    AND pr.month_year = '2026-07'
  GROUP BY pr.id
),
resolved AS (
  SELECT
    pr.id,
    a.full_net,
    ROUND(GREATEST(0, a.full_net - COALESCE(pr.paid_total_salary, 0))::numeric, 2) AS pending_net,
    ROUND(GREATEST(0, a.full_doctor - COALESCE(pr.paid_doctor_share_amount, 0))::numeric, 2) AS pending_doctor,
    ROUND(GREATEST(0, a.full_clinic - COALESCE(pr.paid_clinic_share_amount, 0))::numeric, 2) AS pending_clinic,
    COALESCE(pr.paid_total_salary, 0) AS paid_total
  FROM public.payroll_records pr
  JOIN accrued a ON a.record_id = pr.id
)
UPDATE public.payroll_records pr
SET
  total_salary = r.pending_net,
  doctor_share_amount = r.pending_doctor,
  clinic_share_amount = r.pending_clinic,
  status = CASE
    WHEN r.pending_net <= 0.01 AND r.paid_total > 0 THEN 'paid'
    ELSE 'generated'
  END
FROM resolved r
WHERE pr.id = r.id;

-- ═══════════════════════════════════════════════════════════════
-- 4) تحقق — يجب أن يصبح legacy_assistant_records = 56,000
--    و net_profit_app_formula ≈ 1,156,500
--    (1,597,500 - 385,000 - 56,000 = 1,156,500)
--    شغّل تفصيل 10 من 46-accounting-logic-verification.sql بعد هذا
-- ═══════════════════════════════════════════════════════════════
SELECT
  pr.assistant_name_ar,
  pr.status,
  pr.total_salary AS pending_total,
  pr.clinic_share_amount AS pending_clinic,
  pr.paid_clinic_share_amount,
  pr.paid_doctor_share_amount,
  pr.paid_total_salary,
  ROUND(SUM(pr.paid_clinic_share_amount) OVER (), 2) AS sum_paid_clinic
FROM public.payroll_records pr
JOIN public.clinics c ON c.id = pr.clinic_id
WHERE c.name_ar ILIKE '%الحلو%'
  AND pr.month_year = '2026-07'
ORDER BY pr.assistant_name_ar;
