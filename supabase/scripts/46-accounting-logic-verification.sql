-- =============================================================================
-- فحص منطق الحسابات — Master Clinic Plus
-- شغّله في Supabase → SQL Editor
--
-- يتحقق من:
--   1) دفع مراجع → حصة طبيب + حصة عيادة = المحصّل
--   2) كشفية → للعيادة فقط (لا حصة طبيب)
--   3) أجور مساعد → خصم طبيب + عيادة حسب النسبة
--   4) صرفية عيادة → من العيادة فقط
--   5) صرفية طبيب → تقسيم حسب النسبة المدخلة
--   6) عدم تكرار الحركات المالية (reference_id)
--   7) شحن رصيد العيادة
--
-- طريقة الاستخدام:
--   1) عدّل قسم «الإعدادات» أدناه (اسم العيادة أو UUID)
--   2) شغّل «ملخص الفحص» أولاً — يعرض ✅ / ❌
--   3) شغّل الأقسام التفصيلية عند ظهور ❌
-- =============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- الإعدادات — عدّل هنا
-- ═══════════════════════════════════════════════════════════════════════════
-- clinic_id:      ضع UUID العيادة، أو NULL للبحث بالاسم
-- clinic_name:    جزء من اسم العيادة (مثل: الحلو)، يُستخدم إذا clinic_id = NULL
-- period_from/to: فترة الفحص (افتراضي: هذا الشهر حتى اليوم)

DROP TABLE IF EXISTS _acct_check_config;
CREATE TEMP TABLE _acct_check_config AS
SELECT
  NULL::uuid AS clinic_id,
  'الحلو'::text AS clinic_name_like,
  DATE_TRUNC('month', CURRENT_DATE)::date AS period_from,
  CURRENT_DATE::date AS period_to;

-- حلّ العيادة المستهدفة
DROP TABLE IF EXISTS _acct_clinic;
CREATE TEMP TABLE _acct_clinic AS
SELECT c.id, c.name_ar
FROM public.clinics c
CROSS JOIN _acct_check_config cfg
WHERE (
    cfg.clinic_id IS NOT NULL AND c.id = cfg.clinic_id
  )
  OR (
    cfg.clinic_id IS NULL
    AND (
      cfg.clinic_name_like IS NULL
      OR c.name_ar ILIKE '%' || cfg.clinic_name_like || '%'
      OR c.name ILIKE '%' || cfg.clinic_name_like || '%'
    )
  );

-- إن لم تُعثر على عيادة:
SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM _acct_clinic) THEN '✅ عيادة مستهدفة: ' || (
      SELECT string_agg(name_ar || ' (' || id::text || ')', ', ') FROM _acct_clinic
    )
    ELSE '❌ لم تُعثر على عيادة — عدّل clinic_id أو clinic_name_like في الإعدادات'
  END AS setup_status;


-- ═══════════════════════════════════════════════════════════════════════════
-- ملخص الفحص — شغّل هذا أولاً
-- ═══════════════════════════════════════════════════════════════════════════
WITH cfg AS (
  SELECT period_from, period_to FROM _acct_check_config LIMIT 1
),
clinics AS (
  SELECT id, name_ar FROM _acct_clinic
),
-- 1) حصص الدفع: طبيب + عيادة ≈ المحصّل
pay_share_imbalance AS (
  SELECT po.clinic_id, COUNT(*) AS bad_rows
  FROM public.patient_operations po
  JOIN clinics c ON c.id = po.clinic_id
  CROSS JOIN cfg
  WHERE po.operation_date BETWEEN cfg.period_from AND cfg.period_to
    AND COALESCE(po.paid_amount, 0) > 0
    AND COALESCE(po.session_kind, '') NOT IN ('refund', 'discount')
    AND (
      COALESCE(po.doctor_share_amount, 0) > 0
      OR COALESCE(po.clinic_share_amount, 0) > 0
    )
    AND ABS(
      COALESCE(po.paid_amount, 0)
      - COALESCE(po.doctor_share_amount, 0)
      - COALESCE(po.clinic_share_amount, 0)
    ) > 1.01
  GROUP BY po.clinic_id
),
-- 2) جلسات مدفوعة بلا حصة مجمدة
pay_missing_shares AS (
  SELECT po.clinic_id, COUNT(*) AS bad_rows
  FROM public.patient_operations po
  JOIN clinics c ON c.id = po.clinic_id
  CROSS JOIN cfg
  WHERE po.operation_date BETWEEN cfg.period_from AND cfg.period_to
    AND COALESCE(po.paid_amount, 0) > 0
    AND COALESCE(po.session_kind, '') NOT IN ('refund', 'discount')
    AND COALESCE(po.doctor_share_amount, 0) = 0
    AND COALESCE(po.clinic_share_amount, 0) = 0
  GROUP BY po.clinic_id
),
-- 3) كشفية فقط لكن للطبيب حصة > 0
review_fee_doctor_leak AS (
  SELECT po.clinic_id, COUNT(*) AS bad_rows
  FROM public.patient_operations po
  JOIN clinics c ON c.id = po.clinic_id
  CROSS JOIN cfg
  WHERE po.operation_date BETWEEN cfg.period_from AND cfg.period_to
    AND COALESCE(po.paid_amount, 0) > 0
    AND COALESCE(po.review_fee_amount, 0) > 0
    AND (
      COALESCE(po.is_review_statement, false) = true
      OR COALESCE(po.paid_amount, 0) <= COALESCE(po.review_fee_amount, 0) + 0.01
    )
    AND COALESCE(po.doctor_share_amount, 0) > 0.01
  GROUP BY po.clinic_id
),
-- 4) كشفية مضاعفة محتملة (35k بدل 30k)
review_fee_overbump AS (
  SELECT po.clinic_id, COUNT(*) AS bad_rows
  FROM public.patient_operations po
  JOIN clinics c ON c.id = po.clinic_id
  CROSS JOIN cfg
  WHERE po.operation_date BETWEEN cfg.period_from AND cfg.period_to
    AND COALESCE(po.review_fee_amount, 0) > 0
    AND COALESCE(po.paid_amount, 0) > COALESCE(po.review_fee_amount, 0)
    AND COALESCE(po.is_review_statement, false) = true
    AND (po.paid_amount / NULLIF(po.review_fee_amount, 0)) BETWEEN 6.5 AND 7.5
  GROUP BY po.clinic_id
),
-- 5) صرفيات طبيب: مجموع حركات ≠ مبلغ الفاتورة
doctor_expense_mismatch AS (
  SELECT de.clinic_id, COUNT(*) AS bad_rows
  FROM public.doctor_expenses de
  JOIN clinics c ON c.id = de.clinic_id
  CROSS JOIN cfg
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type = 'doctor_expense_doctor'), 0) AS doc_tx,
      COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type = 'doctor_expense_clinic'), 0) AS clinic_tx
    FROM public.transactions t
    WHERE t.clinic_id = de.clinic_id
      AND t.reference_id::text = de.id::text
      AND t.type IN ('doctor_expense_doctor', 'doctor_expense_clinic')
  ) tx ON true
  WHERE de.expense_date BETWEEN cfg.period_from AND cfg.period_to
    AND de.amount > 0
    AND ABS(
      de.amount - COALESCE(tx.doc_tx, 0) - COALESCE(tx.clinic_tx, 0)
    ) > 1.01
  GROUP BY de.clinic_id
),
-- 6) صرفيات طبيب بلا حركات مالية
doctor_expense_no_tx AS (
  SELECT de.clinic_id, COUNT(*) AS bad_rows
  FROM public.doctor_expenses de
  JOIN clinics c ON c.id = de.clinic_id
  CROSS JOIN cfg
  WHERE de.expense_date BETWEEN cfg.period_from AND cfg.period_to
    AND de.amount > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.clinic_id = de.clinic_id
        AND t.reference_id::text = de.id::text
        AND t.type IN ('doctor_expense_doctor', 'doctor_expense_clinic')
    )
  GROUP BY de.clinic_id
),
-- 7) أجور مساعد: دفعة ناقصة عندما النسبة بين 1% و 99%
assistant_payroll_incomplete AS (
  SELECT b.clinic_id, COUNT(*) AS bad_rows
  FROM (
    SELECT
      t.clinic_id,
      t.reference_id,
      BOOL_OR(t.type = 'assistant_payroll_doctor') AS has_doctor,
      BOOL_OR(t.type = 'assistant_payroll_clinic') AS has_clinic
    FROM public.transactions t
    JOIN clinics c ON c.id = t.clinic_id
    CROSS JOIN cfg
    WHERE t.transaction_date BETWEEN cfg.period_from AND cfg.period_to
      AND t.type IN ('assistant_payroll_doctor', 'assistant_payroll_clinic')
      AND t.reference_id IS NOT NULL
    GROUP BY t.clinic_id, t.reference_id
  ) b
  JOIN public.payroll_records pr
    ON pr.id::text = split_part(b.reference_id::text, ':from:', 1)
  WHERE pr.doctor_share_percentage > 0
    AND pr.doctor_share_percentage < 100
    AND (
      (b.has_doctor AND NOT b.has_clinic)
      OR (b.has_clinic AND NOT b.has_doctor)
    )
  GROUP BY b.clinic_id
),
-- 8) تكرار حركة مالية (نفس المرجع)
duplicate_transactions AS (
  SELECT t.clinic_id, COUNT(*) AS bad_rows
  FROM (
    SELECT clinic_id, reference_type, reference_id, COUNT(*) AS cnt
    FROM public.transactions t
    JOIN clinics c ON c.id = t.clinic_id
    CROSS JOIN cfg
    WHERE t.transaction_date BETWEEN cfg.period_from AND cfg.period_to
      AND t.reference_type IS NOT NULL
      AND t.reference_id IS NOT NULL
    GROUP BY clinic_id, reference_type, reference_id
    HAVING COUNT(*) > 1
  ) t
  GROUP BY t.clinic_id
),
-- 9) تجميع الفترة: محصّل مقابل حصص calc_*
period_totals AS (
  SELECT
    po.clinic_id,
    ROUND(COALESCE(SUM(po.paid_amount) FILTER (
      WHERE COALESCE(po.paid_amount, 0) > 0
        AND COALESCE(po.session_kind, '') NOT IN ('refund', 'discount')
    ), 0)::numeric, 2) AS collected,
    ROUND(COALESCE(SUM(
      public.calc_doctor_operation_earned(
        po.doctor_id,
        po.doctor_share_amount,
        po.paid_amount,
        po.treatment_case_id
      )
    ) FILTER (
      WHERE COALESCE(po.paid_amount, 0) > 0
        AND COALESCE(po.session_kind, '') NOT IN ('refund', 'discount')
    ), 0)::numeric, 2) AS doctor_share_calc,
    ROUND(COALESCE(SUM(
      public.calc_clinic_operation_earned(
        po.doctor_id,
        po.clinic_share_amount,
        po.paid_amount,
        po.treatment_case_id
      )
    ) FILTER (
      WHERE COALESCE(po.paid_amount, 0) > 0
        AND COALESCE(po.session_kind, '') NOT IN ('refund', 'discount')
    ), 0)::numeric, 2) AS clinic_share_calc,
    ROUND(COALESCE(SUM(COALESCE(po.review_fee_amount, 0)) FILTER (
      WHERE COALESCE(po.paid_amount, 0) > 0
        AND COALESCE(po.review_fee_amount, 0) > 0
    ), 0)::numeric, 2) AS review_fees_sum
  FROM public.patient_operations po
  JOIN clinics c ON c.id = po.clinic_id
  CROSS JOIN cfg
  WHERE po.operation_date BETWEEN cfg.period_from AND cfg.period_to
  GROUP BY po.clinic_id
),
checks AS (
  SELECT c.id AS clinic_id, c.name_ar AS clinic_name, '1. حصص الدفع (طبيب+عيادة=محصّل)' AS check_name,
    COALESCE(psi.bad_rows, 0) AS bad_rows,
    'جلسات paid ≠ doctor_share + clinic_share' AS detail
  FROM clinics c
  LEFT JOIN pay_share_imbalance psi ON psi.clinic_id = c.id
  UNION ALL
  SELECT c.id, c.name_ar, '2. جلسات مدفوعة بلا حصة مجمدة',
    COALESCE(pms.bad_rows, 0), 'paid>0 لكن doctor_share و clinic_share = 0'
  FROM clinics c LEFT JOIN pay_missing_shares pms ON pms.clinic_id = c.id
  UNION ALL
  SELECT c.id, c.name_ar, '3. كشفية فقط — حصة طبيب يجب = 0',
    COALESCE(rdl.bad_rows, 0), 'كشفية دخلت محفظة الطبيب'
  FROM clinics c LEFT JOIN review_fee_doctor_leak rdl ON rdl.clinic_id = c.id
  UNION ALL
  SELECT c.id, c.name_ar, '4. كشفية مضاعفة (35k بدل 30k)',
    COALESCE(rbo.bad_rows, 0), 'paid/review_fee ≈ 7 — يحتاج تصحيح'
  FROM clinics c LEFT JOIN review_fee_overbump rbo ON rbo.clinic_id = c.id
  UNION ALL
  SELECT c.id, c.name_ar, '5. صرفية طبيب — حركات ≠ المبلغ',
    COALESCE(dem.bad_rows, 0), 'doctor_expense_doctor + doctor_expense_clinic ≠ amount'
  FROM clinics c LEFT JOIN doctor_expense_mismatch dem ON dem.clinic_id = c.id
  UNION ALL
  SELECT c.id, c.name_ar, '6. صرفية طبيب بلا حركة مالية',
    COALESCE(den.bad_rows, 0), 'فاتورة بدون transactions'
  FROM clinics c LEFT JOIN doctor_expense_no_tx den ON den.clinic_id = c.id
  UNION ALL
  SELECT c.id, c.name_ar, '7. أجور مساعد — دفعة ناقصة',
    COALESCE(api.bad_rows, 0), 'طبيب أو عيادة فقط بدون الطرف الآخر'
  FROM clinics c LEFT JOIN assistant_payroll_incomplete api ON api.clinic_id = c.id
  UNION ALL
  SELECT c.id, c.name_ar, '8. تكرار حركة مالية (reference)',
    COALESCE(dt.bad_rows, 0), 'نفس reference_type + reference_id مرتين'
  FROM clinics c LEFT JOIN duplicate_transactions dt ON dt.clinic_id = c.id
  UNION ALL
  SELECT c.id, c.name_ar, '9. تجميع الفترة: محصّل = حصص',
    CASE WHEN ABS(pt.collected - pt.doctor_share_calc - pt.clinic_share_calc) > 5 THEN 1 ELSE 0 END,
    'collected=' || pt.collected::text || ' doctor=' || pt.doctor_share_calc::text
      || ' clinic=' || pt.clinic_share_calc::text || ' review=' || pt.review_fees_sum::text
  FROM clinics c
  LEFT JOIN period_totals pt ON pt.clinic_id = c.id
)
SELECT
  clinic_name,
  check_name,
  CASE WHEN bad_rows = 0 THEN '✅ OK' ELSE '❌ ' || bad_rows::text || ' مشكلة' END AS status,
  bad_rows,
  detail
FROM checks
ORDER BY clinic_name, check_name;


-- ═══════════════════════════════════════════════════════════════════════════
-- تفصيل 1 — جلسات حصصها غير متوازنة (طبيب + عيادة ≠ محصّل)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  c.name_ar AS clinic_name,
  po.id AS operation_id,
  po.operation_date,
  po.session_kind,
  po.paid_amount,
  po.doctor_share_amount,
  po.clinic_share_amount,
  ROUND(
    COALESCE(po.paid_amount, 0)
    - COALESCE(po.doctor_share_amount, 0)
    - COALESCE(po.clinic_share_amount, 0),
    2
  ) AS diff,
  po.review_fee_amount,
  po.is_review_statement
FROM public.patient_operations po
JOIN _acct_clinic c ON c.id = po.clinic_id
CROSS JOIN _acct_check_config cfg
WHERE po.operation_date BETWEEN cfg.period_from AND cfg.period_to
  AND COALESCE(po.paid_amount, 0) > 0
  AND COALESCE(po.session_kind, '') NOT IN ('refund', 'discount')
  AND ABS(
    COALESCE(po.paid_amount, 0)
    - COALESCE(po.doctor_share_amount, 0)
    - COALESCE(po.clinic_share_amount, 0)
  ) > 1.01
ORDER BY po.operation_date DESC, po.id
LIMIT 50;


-- ═══════════════════════════════════════════════════════════════════════════
-- تفصيل 2 — كشفية دخلت محفظة الطبيب
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  c.name_ar AS clinic_name,
  d.full_name_ar AS doctor_name,
  po.id AS operation_id,
  po.operation_date,
  po.paid_amount,
  po.review_fee_amount,
  po.doctor_share_amount,
  po.clinic_share_amount,
  po.is_review_statement
FROM public.patient_operations po
JOIN _acct_clinic c ON c.id = po.clinic_id
LEFT JOIN public.doctors d ON d.id = po.doctor_id
CROSS JOIN _acct_check_config cfg
WHERE po.operation_date BETWEEN cfg.period_from AND cfg.period_to
  AND COALESCE(po.paid_amount, 0) > 0
  AND COALESCE(po.review_fee_amount, 0) > 0
  AND (
    COALESCE(po.is_review_statement, false) = true
    OR COALESCE(po.paid_amount, 0) <= COALESCE(po.review_fee_amount, 0) + 0.01
  )
  AND COALESCE(po.doctor_share_amount, 0) > 0.01
ORDER BY po.operation_date DESC
LIMIT 50;


-- ═══════════════════════════════════════════════════════════════════════════
-- تفصيل 3 — صرفيات الأطباء (تقسيم النسبة)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  c.name_ar AS clinic_name,
  d.full_name_ar AS doctor_name,
  de.id AS expense_id,
  de.expense_date,
  de.amount AS expense_amount,
  de.percentage_split,
  ROUND(de.amount * COALESCE(de.percentage_split, 0) / 100, 2) AS expected_doctor_share,
  ROUND(de.amount * (100 - COALESCE(de.percentage_split, 0)) / 100, 2) AS expected_clinic_share,
  tx.doc_tx AS actual_doctor_tx,
  tx.clinic_tx AS actual_clinic_tx,
  CASE
    WHEN tx.doc_tx IS NULL AND tx.clinic_tx IS NULL THEN '❌ بلا حركات'
    WHEN ABS(de.amount - COALESCE(tx.doc_tx, 0) - COALESCE(tx.clinic_tx, 0)) > 1.01 THEN '❌ مجموع ≠ المبلغ'
    ELSE '✅ OK'
  END AS status
FROM public.doctor_expenses de
JOIN _acct_clinic c ON c.id = de.clinic_id
JOIN public.doctors d ON d.id = de.doctor_id
CROSS JOIN _acct_check_config cfg
LEFT JOIN LATERAL (
  SELECT
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type = 'doctor_expense_doctor'), 0) AS doc_tx,
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type = 'doctor_expense_clinic'), 0) AS clinic_tx
  FROM public.transactions t
  WHERE t.clinic_id = de.clinic_id
    AND t.reference_id::text = de.id::text
) tx ON true
WHERE de.expense_date BETWEEN cfg.period_from AND cfg.period_to
ORDER BY de.expense_date DESC
LIMIT 50;


-- ═══════════════════════════════════════════════════════════════════════════
-- تفصيل 4 — صرفيات العيادة (من expenses فقط)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  c.name_ar AS clinic_name,
  e.id AS expense_id,
  e.expense_date,
  e.description_ar,
  e.amount,
  e.expense_kind,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.clinic_id = e.clinic_id
        AND t.reference_type = 'expense'
        AND t.reference_id::text = e.id::text
        AND t.type = 'clinic_expense'
    ) THEN '✅ حركة مالية مسجّلة'
    ELSE '⚠️ بلا حركة clinic_expense'
  END AS tx_status
FROM public.expenses e
JOIN _acct_clinic c ON c.id = e.clinic_id
CROSS JOIN _acct_check_config cfg
WHERE e.expense_date BETWEEN cfg.period_from AND cfg.period_to
  AND COALESCE(e.expense_kind, 'general') <> 'doctor_salary'
ORDER BY e.expense_date DESC
LIMIT 50;


-- ═══════════════════════════════════════════════════════════════════════════
-- تفصيل 5 — أجور مساعدي الأطباء (طبيب + عيادة)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  c.name_ar AS clinic_name,
  t.reference_id,
  MIN(t.transaction_date) AS pay_date,
  COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type = 'assistant_payroll_doctor'), 0) AS doctor_deduction,
  COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type = 'assistant_payroll_clinic'), 0) AS clinic_deduction,
  ROUND(
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type = 'assistant_payroll_doctor'), 0)
    + COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type = 'assistant_payroll_clinic'), 0),
    2
  ) AS total_paid,
  MAX(t.description_ar) AS sample_desc,
  CASE
    WHEN COUNT(*) FILTER (WHERE t.type = 'assistant_payroll_doctor') = 0 THEN '❌ بلا خصم طبيب'
    WHEN COUNT(*) FILTER (WHERE t.type = 'assistant_payroll_clinic') = 0 THEN '❌ بلا خصم عيادة'
    ELSE '✅ OK'
  END AS status
FROM public.transactions t
JOIN _acct_clinic c ON c.id = t.clinic_id
CROSS JOIN _acct_check_config cfg
WHERE t.transaction_date BETWEEN cfg.period_from AND cfg.period_to
  AND t.type IN ('assistant_payroll_doctor', 'assistant_payroll_clinic')
GROUP BY c.name_ar, t.reference_id
ORDER BY pay_date DESC
LIMIT 50;


-- ═══════════════════════════════════════════════════════════════════════════
-- تفصيل 6 — حركات مالية مكررة (تكرار خصم)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  c.name_ar AS clinic_name,
  t.reference_type,
  t.reference_id,
  t.type,
  COUNT(*) AS duplicate_count,
  ROUND(SUM(t.amount)::numeric, 2) AS total_amount,
  MIN(t.transaction_date) AS first_date,
  MAX(t.transaction_date) AS last_date
FROM public.transactions t
JOIN _acct_clinic c ON c.id = t.clinic_id
CROSS JOIN _acct_check_config cfg
WHERE t.transaction_date BETWEEN cfg.period_from AND cfg.period_to
  AND t.reference_type IS NOT NULL
  AND t.reference_id IS NOT NULL
GROUP BY c.name_ar, t.reference_type, t.reference_id, t.type
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC
LIMIT 50;


-- ═══════════════════════════════════════════════════════════════════════════
-- تفصيل 7 — ملخص مالي للفترة (مقارنة مع اللوحة)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  c.name_ar AS clinic_name,
  cfg.period_from,
  cfg.period_to,
  snap.snapshot_json
FROM _acct_clinic c
CROSS JOIN _acct_check_config cfg
CROSS JOIN LATERAL (
  SELECT public.get_clinic_financial_snapshot(
    c.id,
    cfg.period_from,
    cfg.period_to
  ) AS snapshot_json
) snap;


-- ═══════════════════════════════════════════════════════════════════════════
-- تفصيل 8 — شحنات رصيد العيادة
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  c.name_ar AS clinic_name,
  t.id,
  t.amount,
  t.transaction_date,
  t.created_at,
  t.description_ar,
  t.reference_id
FROM public.transactions t
JOIN _acct_clinic c ON c.id = t.clinic_id
CROSS JOIN _acct_check_config cfg
WHERE t.type = 'balance_topup_clinic'
  AND t.transaction_date BETWEEN cfg.period_from AND cfg.period_to
ORDER BY t.created_at DESC;


-- ═══════════════════════════════════════════════════════════════════════════
-- تفصيل 9 — مجاميع الحركات حسب النوع (هذا الشهر)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  c.name_ar AS clinic_name,
  t.type,
  COUNT(*) AS row_count,
  ROUND(SUM(t.amount)::numeric, 2) AS total_amount
FROM public.transactions t
JOIN _acct_clinic c ON c.id = t.clinic_id
CROSS JOIN _acct_check_config cfg
WHERE t.transaction_date BETWEEN cfg.period_from AND cfg.period_to
GROUP BY c.name_ar, t.type
ORDER BY c.name_ar, t.type;


-- ═══════════════════════════════════════════════════════════════════════════
-- تفصيل 10 — تفكيك صافي ربح العيادة (مطابقة لوحة التحكم)
-- ═══════════════════════════════════════════════════════════════════════════
WITH cfg AS (
  SELECT period_from, period_to FROM _acct_check_config LIMIT 1
),
clinic_shares AS (
  SELECT
    po.clinic_id,
    ROUND(COALESCE(SUM(po.paid_amount) FILTER (
      WHERE COALESCE(po.paid_amount, 0) > 0
        AND COALESCE(po.session_kind, '') NOT IN ('refund', 'discount')
    ), 0)::numeric, 2) AS collected,
    ROUND(COALESCE(SUM(
      public.calc_doctor_operation_earned(
        po.doctor_id, po.doctor_share_amount, po.paid_amount, po.treatment_case_id
      )
    ) FILTER (
      WHERE COALESCE(po.paid_amount, 0) > 0
        AND COALESCE(po.session_kind, '') NOT IN ('refund', 'discount')
    ), 0)::numeric, 2) AS doctor_share
  FROM public.patient_operations po
  JOIN _acct_clinic c ON c.id = po.clinic_id
  CROSS JOIN cfg
  WHERE po.operation_date BETWEEN cfg.period_from AND cfg.period_to
  GROUP BY po.clinic_id
),
expenses AS (
  SELECT
    e.clinic_id,
    ROUND(COALESCE(SUM(e.amount) FILTER (
      WHERE COALESCE(e.expense_kind, 'general') <> 'doctor_salary'
    ), 0)::numeric, 2) AS general_expenses,
    ROUND(COALESCE(SUM(ABS(t.amount)) FILTER (
      WHERE t.type = 'doctor_expense_clinic' AND t.amount < 0
    ), 0)::numeric, 2) AS doctor_expense_clinic
  FROM public.expenses e
  JOIN _acct_clinic c ON c.id = e.clinic_id
  CROSS JOIN cfg
  LEFT JOIN public.transactions t
    ON t.clinic_id = e.clinic_id
   AND t.type = 'doctor_expense_clinic'
   AND t.transaction_date BETWEEN cfg.period_from AND cfg.period_to
  WHERE e.expense_date BETWEEN cfg.period_from AND cfg.period_to
  GROUP BY e.clinic_id
),
confirmed_payroll AS (
  SELECT
    t.clinic_id,
    ROUND(COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.amount < 0), 0)::numeric, 2)
      - ROUND(COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::numeric, 2) AS confirmed_salaries
  FROM public.transactions t
  JOIN _acct_clinic c ON c.id = t.clinic_id
  CROSS JOIN cfg
  WHERE t.transaction_date BETWEEN cfg.period_from AND cfg.period_to
    AND t.type IN ('staff_salary_paid', 'assistant_payroll_clinic', 'doctor_salary_paid')
  GROUP BY t.clinic_id
),
legacy_staff_slips AS (
  SELECT
    ss.clinic_id,
    ROUND(COALESCE(SUM(
      CASE
        WHEN COALESCE(ss.paid_net_payout, 0) > 0 THEN ss.paid_net_payout
        WHEN ss.status = 'paid' THEN COALESCE(ss.net_payout, 0)
        ELSE 0
      END
    ), 0)::numeric, 2) AS staff_legacy
  FROM public.salary_slips ss
  JOIN _acct_clinic c ON c.id = ss.clinic_id
  CROSS JOIN cfg
  WHERE (
      (ss.paid_at IS NOT NULL AND ss.paid_at::date BETWEEN cfg.period_from AND cfg.period_to)
      OR (
        ss.month_year IS NOT NULL
        AND ss.month_year >= to_char(cfg.period_from, 'YYYY-MM')
        AND ss.month_year <= to_char(cfg.period_to, 'YYYY-MM')
      )
    )
    AND (
      COALESCE(ss.paid_net_payout, 0) > 0
      OR ss.status = 'paid'
    )
  GROUP BY ss.clinic_id
),
legacy_assistant_records AS (
  SELECT
    pr.clinic_id,
    ROUND(COALESCE(SUM(
      CASE
        WHEN COALESCE(pr.paid_clinic_share_amount, 0) > 0 THEN pr.paid_clinic_share_amount
        WHEN pr.status = 'paid' THEN COALESCE(pr.clinic_share_amount, 0)
        ELSE 0
      END
    ), 0)::numeric, 2) AS assistant_legacy
  FROM public.payroll_records pr
  JOIN _acct_clinic c ON c.id = pr.clinic_id
  CROSS JOIN cfg
  WHERE (
      (pr.paid_at IS NOT NULL AND pr.paid_at::date BETWEEN cfg.period_from AND cfg.period_to)
      OR (
        pr.month_year IS NOT NULL
        AND pr.month_year >= to_char(cfg.period_from, 'YYYY-MM')
        AND pr.month_year <= to_char(cfg.period_to, 'YYYY-MM')
      )
    )
    AND (
      COALESCE(pr.paid_clinic_share_amount, 0) > 0
      OR pr.status = 'paid'
    )
  GROUP BY pr.clinic_id
),
registered_assistant AS (
  SELECT
    se.clinic_id,
    ROUND(COALESCE(SUM(
      se.amount * (100 - COALESCE(a.doctor_share_percentage, 0)) / 100
    ), 0)::numeric, 2) AS registered_clinic_share
  FROM public.salary_entries se
  JOIN _acct_clinic c ON c.id = se.clinic_id
  JOIN public.assistants a ON a.id = se.assistant_id
  CROSS JOIN cfg
  WHERE se.entry_date BETWEEN cfg.period_from AND cfg.period_to
    AND se.entry_type = 'daily_wage'
    AND NOT EXISTS (
      SELECT 1 FROM public.transactions tx
      WHERE tx.clinic_id = se.clinic_id
        AND tx.type IN ('assistant_payroll_doctor', 'assistant_payroll_clinic')
        AND tx.transaction_date BETWEEN cfg.period_from AND cfg.period_to
        AND tx.description_ar ILIKE '%' || COALESCE(a.full_name_ar, '') || '%'
    )
  GROUP BY se.clinic_id
),
topups AS (
  SELECT
    t.clinic_id,
    ROUND(COALESCE(SUM(t.amount), 0)::numeric, 2) AS balance_topups
  FROM public.transactions t
  JOIN _acct_clinic c ON c.id = t.clinic_id
  CROSS JOIN cfg
  WHERE t.type = 'balance_topup_clinic'
    AND t.transaction_date BETWEEN cfg.period_from AND cfg.period_to
  GROUP BY t.clinic_id
)
SELECT
  c.name_ar AS clinic_name,
  cfg.period_from,
  cfg.period_to,
  cs.collected,
  cs.doctor_share,
  ROUND((cs.collected - cs.doctor_share)::numeric, 2) AS clinic_share,
  COALESCE(e.general_expenses, 0) + COALESCE(e.doctor_expense_clinic, 0) AS total_expenses,
  COALESCE(cp.confirmed_salaries, 0) AS confirmed_salaries,
  COALESCE(ls.staff_legacy, 0) AS legacy_staff_slips,
  COALESCE(la.assistant_legacy, 0) AS legacy_assistant_records,
  COALESCE(ra.registered_clinic_share, 0) AS registered_assistant_not_in_profit,
  COALESCE(tp.balance_topups, 0) AS balance_topups,
  ROUND(
    (cs.collected - cs.doctor_share)
    - (COALESCE(e.general_expenses, 0) + COALESCE(e.doctor_expense_clinic, 0))
    - CASE
        WHEN COALESCE(cp.confirmed_salaries, 0) > 0 THEN cp.confirmed_salaries
        ELSE COALESCE(ls.staff_legacy, 0)
      END
    + COALESCE(tp.balance_topups, 0),
    2
  ) AS net_profit_app_formula,
  ROUND(
    (cs.collected - cs.doctor_share)
    - (COALESCE(e.general_expenses, 0) + COALESCE(e.doctor_expense_clinic, 0))
    - COALESCE(cp.confirmed_salaries, 0)
    - COALESCE(ra.registered_clinic_share, 0)
    + COALESCE(tp.balance_topups, 0),
    2
  ) AS net_profit_old_with_registered
FROM _acct_clinic c
CROSS JOIN cfg
LEFT JOIN clinic_shares cs ON cs.clinic_id = c.id
LEFT JOIN expenses e ON e.clinic_id = c.id
LEFT JOIN confirmed_payroll cp ON cp.clinic_id = c.id
LEFT JOIN legacy_staff_slips ls ON ls.clinic_id = c.id
LEFT JOIN legacy_assistant_records la ON la.clinic_id = c.id
LEFT JOIN registered_assistant ra ON ra.clinic_id = c.id
LEFT JOIN topups tp ON tp.clinic_id = c.id;
