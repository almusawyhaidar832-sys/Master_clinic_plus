-- مزامنة رواتب دُفعت فعلياً لكن تظهر «غير مؤكَّدة» في رواتب الشهر
-- شغّل مرة واحدة بعد التحديث — لا يُنشئ حركات مالية جديدة (لا خصم مضاعف)

-- 1) سجلات status=paid لكن paid_* صفر (أرشيف قديم)
UPDATE public.payroll_records
SET
  paid_total_salary = GREATEST(
    COALESCE(NULLIF(paid_total_salary, 0), total_salary),
    COALESCE(paid_doctor_share_amount, 0) + COALESCE(paid_clinic_share_amount, 0)
  ),
  paid_doctor_share_amount = COALESCE(NULLIF(paid_doctor_share_amount, 0), doctor_share_amount),
  paid_clinic_share_amount = COALESCE(NULLIF(paid_clinic_share_amount, 0), clinic_share_amount),
  paid_at = COALESCE(paid_at, NOW())
WHERE status = 'paid'
  AND COALESCE(paid_total_salary, 0) = 0
  AND COALESCE(total_salary, 0) > 0;

-- 2) paid_clinic_share مُعبَّأ لكن status ما زال generated — لا ترفع paid_* فوق القيم المخزّنة
UPDATE public.payroll_records
SET
  status = 'paid',
  paid_at = COALESCE(paid_at, NOW())
WHERE COALESCE(paid_clinic_share_amount, 0) > 0
  AND COALESCE(clinic_share_amount, 0) > 0
  AND paid_clinic_share_amount >= clinic_share_amount - 0.01
  AND COALESCE(paid_doctor_share_amount, 0) >= doctor_share_amount - 0.01
  AND status <> 'paid';

-- 3) قسائم موظفين: status=paid لكن paid_net_payout صفر
UPDATE public.salary_slips
SET
  paid_net_payout = net_payout,
  paid_at = COALESCE(paid_at, NOW())
WHERE status = 'paid'
  AND COALESCE(paid_net_payout, 0) = 0
  AND COALESCE(net_payout, 0) > 0;

-- 4) قسائم: paid_net_payout مُعبَّأ لكن status مسودة
UPDATE public.salary_slips
SET
  status = 'paid',
  paid_at = COALESCE(paid_at, NOW())
WHERE COALESCE(paid_net_payout, 0) > 0
  AND paid_net_payout >= net_payout - 0.01
  AND status <> 'paid';

-- 5) مساعدون دُفع أجرهم اليومي نقداً (بدون حركات تأكيد) — اختياري لعيادة محددة
--    يُعلِّم السجل مُؤكَّداً من مجموع daily_wage المسجَّل — لا يُنشئ transactions
--    غيّر اسم العيادة والشهر قبل التشغيل
/*
WITH cfg AS (
  SELECT '2026-07'::text AS month_year, '%الحلو%'::text AS clinic_pattern
),
entry_breakdown AS (
  SELECT
    pr.id AS record_id,
    ROUND(SUM(se.amount)::numeric, 2) AS total_salary,
    ROUND(SUM(se.amount * COALESCE(a.doctor_share_percentage, 0) / 100)::numeric, 2) AS doctor_share,
    ROUND(SUM(se.amount * (100 - COALESCE(a.doctor_share_percentage, 0)) / 100)::numeric, 2) AS clinic_share
  FROM public.payroll_records pr
  JOIN public.clinics c ON c.id = pr.clinic_id
  JOIN public.assistants a ON a.id = pr.assistant_id
  JOIN public.salary_entries se
    ON se.assistant_id = pr.assistant_id
   AND se.clinic_id = pr.clinic_id
   AND se.entry_type = 'daily_wage'
   AND to_char(se.entry_date, 'YYYY-MM') = pr.month_year
  CROSS JOIN cfg
  WHERE pr.month_year = cfg.month_year
    AND c.name_ar ILIKE cfg.clinic_pattern
    AND COALESCE(pr.paid_clinic_share_amount, 0) = 0
    AND NOT EXISTS (
      SELECT 1
      FROM public.transactions tx
      WHERE tx.clinic_id = pr.clinic_id
        AND tx.type IN ('assistant_payroll_doctor', 'assistant_payroll_clinic')
        AND (
          tx.reference_id = pr.id::text
          OR tx.reference_id LIKE pr.id::text || ':%'
        )
    )
  GROUP BY pr.id
  HAVING SUM(se.amount) > 0
)
UPDATE public.payroll_records pr
SET
  total_salary = eb.total_salary,
  doctor_share_amount = eb.doctor_share,
  clinic_share_amount = eb.clinic_share,
  paid_total_salary = eb.total_salary,
  paid_doctor_share_amount = eb.doctor_share,
  paid_clinic_share_amount = eb.clinic_share,
  status = 'paid',
  paid_at = COALESCE(pr.paid_at, NOW())
FROM entry_breakdown eb
WHERE pr.id = eb.record_id;
*/

-- تحقق سريع
SELECT
  c.name_ar,
  pr.month_year,
  pr.assistant_name_ar,
  pr.status,
  pr.total_salary,
  pr.paid_total_salary,
  pr.clinic_share_amount,
  pr.paid_clinic_share_amount,
  pr.paid_at
FROM public.payroll_records pr
JOIN public.clinics c ON c.id = pr.clinic_id
WHERE COALESCE(pr.paid_clinic_share_amount, 0) > 0
   OR pr.status = 'paid'
ORDER BY c.name_ar, pr.month_year DESC, pr.assistant_name_ar;
