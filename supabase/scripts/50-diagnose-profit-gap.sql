-- تشخيص فجوة الربح — عيادة الحلو يوليو 2026 (1–9)
-- المتوقع: 1,597,500 − 385,000 − 56,000 = 1,156,500
-- شغّل كل قسم على حدة في Supabase SQL Editor

-- 1) رواتب مساعدين — paid_clinic (يجب المجموع = 56,000)
SELECT
  c.name_ar AS clinic_name,
  pr.assistant_name_ar,
  pr.status,
  pr.paid_clinic_share_amount,
  ROUND(SUM(pr.paid_clinic_share_amount) OVER (), 2) AS sum_paid_clinic
FROM public.payroll_records pr
JOIN public.clinics c ON c.id = pr.clinic_id
WHERE c.name_ar ILIKE '%الحلو%'
  AND pr.month_year = '2026-07'
ORDER BY pr.assistant_name_ar;

-- 2) مصروفات عامة
SELECT
  c.name_ar AS clinic_name,
  ROUND(COALESCE(SUM(e.amount), 0)::numeric, 2) AS general_expenses,
  json_agg(
    json_build_object(
      'date', e.expense_date,
      'amount', e.amount,
      'description', e.description_ar,
      'kind', COALESCE(e.expense_kind, 'general')
    )
    ORDER BY e.expense_date, e.amount DESC
  ) AS lines
FROM public.expenses e
JOIN public.clinics c ON c.id = e.clinic_id
WHERE c.name_ar ILIKE '%الحلو%'
  AND e.expense_date BETWEEN '2026-07-01' AND '2026-07-09'
  AND COALESCE(e.expense_kind, 'general') <> 'doctor_salary'
GROUP BY c.name_ar;

-- 3) حصة عيادة من صرفيات الأطباء (transactions)
SELECT
  c.name_ar AS clinic_name,
  ROUND(COALESCE(SUM(ABS(t.amount)), 0)::numeric, 2) AS doctor_expense_clinic_share
FROM public.transactions t
JOIN public.clinics c ON c.id = t.clinic_id
WHERE c.name_ar ILIKE '%الحلو%'
  AND t.type = 'doctor_expense_clinic'
  AND t.amount < 0
  AND t.transaction_date BETWEEN '2026-07-01' AND '2026-07-09'
GROUP BY c.name_ar;

-- 4) حركات رواتب مؤكَّدة (يجب 0 أو تطابق المدفوع نقداً)
SELECT
  c.name_ar AS clinic_name,
  t.type,
  t.amount,
  t.transaction_date,
  t.description_ar
FROM public.transactions t
JOIN public.clinics c ON c.id = t.clinic_id
WHERE c.name_ar ILIKE '%الحلو%'
  AND t.transaction_date BETWEEN '2026-07-01' AND '2026-07-09'
  AND t.type IN (
    'staff_salary_paid',
    'assistant_payroll_clinic',
    'assistant_payroll_doctor',
    'doctor_salary_paid'
  )
ORDER BY t.transaction_date, t.type;

-- 5) شحن رصيد (يجب 0)
SELECT
  c.name_ar AS clinic_name,
  t.type,
  t.amount,
  t.transaction_date,
  t.description_ar
FROM public.transactions t
JOIN public.clinics c ON c.id = t.clinic_id
WHERE c.name_ar ILIKE '%الحلو%'
  AND t.type = 'balance_topup_clinic'
  AND t.transaction_date BETWEEN '2026-07-01' AND '2026-07-09';

-- 6) ملخص سريع — يطابق صيغة التطبيق
WITH cfg AS (
  SELECT
    '2026-07-01'::date AS period_from,
    '2026-07-09'::date AS period_to
),
clinic AS (
  SELECT id, name_ar FROM public.clinics WHERE name_ar ILIKE '%الحلو%' LIMIT 1
),
collected AS (
  SELECT ROUND(COALESCE(SUM(
    public.calc_clinic_operation_earned(
      po.doctor_id, po.clinic_share_amount, po.paid_amount, po.treatment_case_id
    )
  ), 0)::numeric, 2) AS clinic_share
  FROM public.patient_operations po
  JOIN clinic c ON c.id = po.clinic_id
  CROSS JOIN cfg
  WHERE po.operation_date BETWEEN cfg.period_from AND cfg.period_to
),
exp AS (
  SELECT
    ROUND(COALESCE(SUM(e.amount) FILTER (
      WHERE COALESCE(e.expense_kind, 'general') <> 'doctor_salary'
    ), 0)::numeric, 2) AS general_expenses,
    ROUND(COALESCE(SUM(ABS(t.amount)), 0)::numeric, 2) AS doctor_expense_clinic
  FROM clinic c
  CROSS JOIN cfg
  LEFT JOIN public.expenses e
    ON e.clinic_id = c.id
   AND e.expense_date BETWEEN cfg.period_from AND cfg.period_to
  LEFT JOIN public.transactions t
    ON t.clinic_id = c.id
   AND t.type = 'doctor_expense_clinic'
   AND t.amount < 0
   AND t.transaction_date BETWEEN cfg.period_from AND cfg.period_to
),
sal AS (
  SELECT ROUND(COALESCE(SUM(pr.paid_clinic_share_amount), 0)::numeric, 2) AS assistant_paid
  FROM public.payroll_records pr
  JOIN clinic c ON c.id = pr.clinic_id
  WHERE pr.month_year = '2026-07'
    AND COALESCE(pr.paid_clinic_share_amount, 0) > 0
),
topup AS (
  SELECT ROUND(COALESCE(SUM(t.amount), 0)::numeric, 2) AS balance_topups
  FROM public.transactions t
  JOIN clinic c ON c.id = t.clinic_id
  CROSS JOIN cfg
  WHERE t.type = 'balance_topup_clinic'
    AND t.transaction_date BETWEEN cfg.period_from AND cfg.period_to
)
SELECT
  c.name_ar,
  cfg.period_from,
  cfg.period_to,
  col.clinic_share,
  exp.general_expenses,
  exp.doctor_expense_clinic,
  exp.general_expenses + exp.doctor_expense_clinic AS total_expenses,
  sal.assistant_paid,
  topup.balance_topups,
  ROUND(
    col.clinic_share
    - (exp.general_expenses + exp.doctor_expense_clinic)
    - sal.assistant_paid
    + topup.balance_topups,
    2
  ) AS net_profit_expected
FROM clinic c
CROSS JOIN cfg
CROSS JOIN collected col
CROSS JOIN exp
CROSS JOIN sal
CROSS JOIN topup;
