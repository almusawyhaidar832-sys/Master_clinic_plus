-- =============================================================================
-- فحص رصيد طبيب (أو أكثر) — Master Clinic Plus
-- شغّله في Supabase → SQL Editor
--
-- حالياً مضبوط على:
--   • د. سجاد  — متوقع 92,500  | النظام ~115,000  | فرق ~22,500
--   • د. حارث  — متوقع 16,000  | النظام ~48,500   | فرق ~32,500
--
-- طريقة الاستخدام:
--   1) عدّل جدول الأطباء في «الإعدادات»
--   2) شغّل «1) ملخص الرصيد» لكل الأطباء
--   3) شغّل «2) كل الدفعات» وانسخ النتيجة وأرسلها
-- =============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- الإعدادات — عدّل هنا
-- ═══════════════════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS _doc_bal_period;
CREATE TEMP TABLE _doc_bal_period AS
SELECT
  NULL::date AS period_from,   -- NULL = كل الفترات
  NULL::date AS period_to;

DROP TABLE IF EXISTS _doc_bal_config;
CREATE TEMP TABLE _doc_bal_config (
  doctor_name_like TEXT NOT NULL,
  doctor_id UUID,
  expected_balance NUMERIC
);

INSERT INTO _doc_bal_config (doctor_name_like, doctor_id, expected_balance) VALUES
  ('سجاد', NULL, 92500),
  ('حارث', NULL, 16000);

-- حلّ الأطباء المستهدفين
DROP TABLE IF EXISTS _doc_target;
CREATE TEMP TABLE _doc_target AS
SELECT DISTINCT ON (d.id)
  d.id,
  d.full_name_ar,
  d.clinic_id,
  c.name_ar AS clinic_name,
  d.percentage,
  d.payment_type,
  d.salary_amount,
  d.is_active,
  cfg.expected_balance,
  cfg.doctor_name_like AS match_pattern
FROM public.doctors d
JOIN public.clinics c ON c.id = d.clinic_id
JOIN _doc_bal_config cfg ON (
    (cfg.doctor_id IS NOT NULL AND d.id = cfg.doctor_id)
    OR (
      cfg.doctor_id IS NULL
      AND d.full_name_ar ILIKE '%' || cfg.doctor_name_like || '%'
    )
  )
ORDER BY d.id, cfg.doctor_name_like;

SELECT
  CASE
    WHEN NOT EXISTS (SELECT 1 FROM _doc_target) THEN
      '❌ لم يُعثر على أي طبيب — عدّل _doc_bal_config'
    ELSE
      '✅ أطباء مستهدفون: ' || (SELECT COUNT(*)::text FROM _doc_target)
  END AS setup_status;

SELECT
  id,
  full_name_ar,
  clinic_name,
  percentage,
  payment_type,
  expected_balance,
  match_pattern,
  is_active
FROM _doc_target
ORDER BY full_name_ar;


-- ═══════════════════════════════════════════════════════════════════════════
-- 1) ملخص الرصيد — شغّل هذا أولاً
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  dt.full_name_ar AS doctor_name,
  dt.clinic_name,
  dt.percentage,
  dt.payment_type,
  dt.expected_balance,
  ROUND(COALESCE(earn.total_earnings, 0)::numeric, 2) AS total_earnings,
  COALESCE(earn.paid_ops_count, 0) AS paid_ops_count,
  ROUND(COALESCE(earn.total_collected, 0)::numeric, 2) AS total_collected_from_ops,
  ROUND(COALESCE(wdr.paid_out, 0)::numeric, 2) AS withdrawals_paid,
  ROUND(COALESCE(wdr.approved, 0)::numeric, 2) AS withdrawals_approved,
  ROUND(COALESCE(wdr.pending, 0)::numeric, 2) AS withdrawals_pending,
  ROUND(COALESCE(ded.expense_deductions, 0)::numeric, 2) AS expense_deductions,
  ROUND(COALESCE(ded.payroll_deductions, 0)::numeric, 2) AS payroll_deductions,
  ROUND(COALESCE(ded.balance_topups, 0)::numeric, 2) AS balance_topups,
  ROUND((
    COALESCE(earn.total_earnings, 0)
    - COALESCE(wdr.paid_out, 0) - COALESCE(wdr.approved, 0)
    - COALESCE(ded.expense_deductions, 0) - COALESCE(ded.payroll_deductions, 0)
    + COALESCE(ded.balance_topups, 0)
  )::numeric, 2) AS balance_manual_calc,
  (public.get_doctor_wallet_stats(dt.id) ->> 'available_balance')::numeric AS balance_from_rpc,
  CASE
    WHEN dt.expected_balance IS NULL THEN NULL
    ELSE ROUND((
      (public.get_doctor_wallet_stats(dt.id) ->> 'available_balance')::numeric
      - dt.expected_balance
    )::numeric, 2)
  END AS gap_vs_expected,
  public.get_doctor_wallet_stats(dt.id) AS wallet_json_full
FROM _doc_target dt
LEFT JOIN LATERAL (
  SELECT
    COALESCE(SUM(
      public.calc_doctor_operation_earned(
        po.doctor_id, po.doctor_share_amount, po.paid_amount, po.treatment_case_id
      )
    ), 0) AS total_earnings,
    COUNT(*) FILTER (WHERE COALESCE(po.paid_amount, 0) > 0) AS paid_ops_count,
    COALESCE(SUM(po.paid_amount) FILTER (WHERE COALESCE(po.paid_amount, 0) > 0), 0) AS total_collected
  FROM public.patient_operations po
  CROSS JOIN _doc_bal_period p
  WHERE po.doctor_id = dt.id
    AND COALESCE(po.paid_amount, 0) > 0
    AND (
      p.period_from IS NULL
      OR po.operation_date BETWEEN p.period_from AND COALESCE(p.period_to, CURRENT_DATE)
    )
) earn ON TRUE
LEFT JOIN LATERAL (
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0) AS paid_out,
    COALESCE(SUM(amount) FILTER (WHERE status = 'approved'), 0) AS approved,
    COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0) AS pending
  FROM public.doctor_withdrawals dw
  WHERE dw.doctor_id = dt.id
) wdr ON TRUE
LEFT JOIN LATERAL (
  SELECT
    COALESCE(SUM(ABS(amount)) FILTER (
      WHERE type = 'doctor_expense_doctor' AND amount < 0
    ), 0) AS expense_deductions,
    COALESCE(SUM(ABS(amount)) FILTER (
      WHERE type = 'assistant_payroll_doctor' AND amount < 0
    ), 0) AS payroll_deductions,
    COALESCE(SUM(amount) FILTER (
      WHERE type = 'balance_topup_doctor' AND amount > 0
    ), 0) AS balance_topups
  FROM public.transactions t
  WHERE t.doctor_id = dt.id
) ded ON TRUE
ORDER BY dt.full_name_ar;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2) كل الدفعات — انسخ النتيجة وأرسلها
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  dt.full_name_ar AS doctor_name,
  po.operation_date,
  pat.full_name_ar AS patient_name,
  po.operation_name_ar,
  po.session_kind,
  ROUND(po.paid_amount::numeric, 2) AS paid_amount,
  ROUND(COALESCE(po.review_fee_amount, 0)::numeric, 2) AS review_fee,
  po.is_review_statement,
  ROUND(COALESCE(po.doctor_share_amount, 0)::numeric, 2) AS frozen_doctor_share,
  ROUND(COALESCE(po.clinic_share_amount, 0)::numeric, 2) AS frozen_clinic_share,
  ROUND(public.calc_doctor_operation_earned(
    po.doctor_id, po.doctor_share_amount, po.paid_amount, po.treatment_case_id
  )::numeric, 2) AS earned_for_wallet,
  ROUND(COALESCE(po.materials_cost, 0)::numeric, 2) AS materials_cost,
  ptc.final_price AS case_final_price,
  ptc.doctor_share_total AS case_doctor_share_total,
  po.treatment_case_id,
  po.id AS operation_id,
  po.patient_id,
  CASE
    WHEN COALESCE(po.paid_amount, 0) <= 0 THEN '—'
    WHEN COALESCE(po.review_fee_amount, 0) > 0
      AND (
        COALESCE(po.is_review_statement, false) = true
        OR COALESCE(po.paid_amount, 0) <= COALESCE(po.review_fee_amount, 0) + 0.01
      )
      AND COALESCE(po.doctor_share_amount, 0) > 0.01
      THEN '⚠️ كشفية — حصة طبيب يجب = 0'
    WHEN COALESCE(po.review_fee_amount, 0) > 0
      AND COALESCE(po.paid_amount, 0) > COALESCE(po.review_fee_amount, 0)
      AND COALESCE(po.is_review_statement, false) = true
      AND (po.paid_amount / NULLIF(po.review_fee_amount, 0)) BETWEEN 6.5 AND 7.5
      THEN '⚠️ كشفية مضاعفة محتملة (35k بدل 30k)'
    WHEN COALESCE(po.paid_amount, 0) > 0
      AND COALESCE(po.doctor_share_amount, 0) = 0
      AND COALESCE(po.clinic_share_amount, 0) = 0
      THEN '⚠️ مدفوع بلا حصة مجمدة'
    WHEN COALESCE(po.paid_amount, 0) > 0
      AND ABS(
        COALESCE(po.paid_amount, 0)
        - COALESCE(po.doctor_share_amount, 0)
        - COALESCE(po.clinic_share_amount, 0)
      ) > 1.01
      THEN '⚠️ paid ≠ doctor + clinic'
    ELSE '✅'
  END AS flag
FROM public.patient_operations po
JOIN _doc_target dt ON dt.id = po.doctor_id
JOIN public.patients pat ON pat.id = po.patient_id
LEFT JOIN public.patient_treatment_cases ptc ON ptc.id = po.treatment_case_id
CROSS JOIN _doc_bal_period p
WHERE COALESCE(po.paid_amount, 0) > 0
  AND (
    p.period_from IS NULL
    OR po.operation_date BETWEEN p.period_from AND COALESCE(p.period_to, CURRENT_DATE)
  )
ORDER BY dt.full_name_ar, po.operation_date ASC, po.created_at ASC;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3) تجميع الدفعات حسب الطبيب واليوم
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  dt.full_name_ar AS doctor_name,
  po.operation_date,
  COUNT(*) AS payment_count,
  ROUND(SUM(po.paid_amount)::numeric, 2) AS day_collected,
  ROUND(SUM(public.calc_doctor_operation_earned(
    po.doctor_id, po.doctor_share_amount, po.paid_amount, po.treatment_case_id
  ))::numeric, 2) AS day_earned,
  COUNT(*) FILTER (
    WHERE COALESCE(po.doctor_share_amount, 0) > 0.01
      AND COALESCE(po.review_fee_amount, 0) > 0
      AND (
        COALESCE(po.is_review_statement, false) = true
        OR COALESCE(po.paid_amount, 0) <= COALESCE(po.review_fee_amount, 0) + 0.01
      )
  ) AS review_fee_leak_count
FROM public.patient_operations po
JOIN _doc_target dt ON dt.id = po.doctor_id
CROSS JOIN _doc_bal_period p
WHERE COALESCE(po.paid_amount, 0) > 0
  AND (
    p.period_from IS NULL
    OR po.operation_date BETWEEN p.period_from AND COALESCE(p.period_to, CURRENT_DATE)
  )
GROUP BY dt.full_name_ar, po.operation_date
ORDER BY dt.full_name_ar, po.operation_date;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4) دفعات مكررة محتملة (نفس طبيب + مريض + مبلغ + يوم)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  dt.full_name_ar AS doctor_name,
  po.operation_date,
  pat.full_name_ar AS patient_name,
  po.paid_amount,
  po.doctor_share_amount,
  COUNT(*) AS duplicate_count,
  string_agg(po.id::text, ', ' ORDER BY po.created_at) AS operation_ids
FROM public.patient_operations po
JOIN _doc_target dt ON dt.id = po.doctor_id
JOIN public.patients pat ON pat.id = po.patient_id
CROSS JOIN _doc_bal_period p
WHERE COALESCE(po.paid_amount, 0) > 0
  AND (
    p.period_from IS NULL
    OR po.operation_date BETWEEN p.period_from AND COALESCE(p.period_to, CURRENT_DATE)
  )
GROUP BY dt.full_name_ar, po.operation_date, pat.full_name_ar, po.paid_amount, po.doctor_share_amount
HAVING COUNT(*) > 1
ORDER BY dt.full_name_ar, duplicate_count DESC, po.operation_date DESC;


-- ═══════════════════════════════════════════════════════════════════════════
-- 5) سحوبات الرصيد
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  dt.full_name_ar AS doctor_name,
  dw.id,
  dw.amount,
  dw.status,
  dw.requested_at,
  dw.processed_at,
  dw.notes
FROM public.doctor_withdrawals dw
JOIN _doc_target dt ON dt.id = dw.doctor_id
ORDER BY dt.full_name_ar, COALESCE(dw.processed_at, dw.requested_at) DESC;


-- ═══════════════════════════════════════════════════════════════════════════
-- 6) صرفيات الطبيب + أجور المساعدين + شحن الرصيد
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  dt.full_name_ar AS doctor_name,
  t.transaction_date,
  t.type,
  t.amount,
  t.description_ar,
  t.reference_type,
  t.reference_id,
  t.created_at
FROM public.transactions t
JOIN _doc_target dt ON dt.id = t.doctor_id
WHERE t.type IN (
  'doctor_expense_doctor',
  'assistant_payroll_doctor',
  'balance_topup_doctor'
)
ORDER BY dt.full_name_ar, t.transaction_date DESC, t.created_at DESC;


-- ═══════════════════════════════════════════════════════════════════════════
-- 7) دفعات مسجّلة على طبيب آخر لنفس مرضى الأطباء المستهدفين
-- ═══════════════════════════════════════════════════════════════════════════
WITH target_patients AS (
  SELECT DISTINCT dt.id AS target_doctor_id, dt.full_name_ar AS target_doctor, po.patient_id
  FROM public.patient_operations po
  JOIN _doc_target dt ON dt.id = po.doctor_id
  WHERE COALESCE(po.paid_amount, 0) > 0
)
SELECT
  tp.target_doctor,
  d_other.full_name_ar AS other_doctor,
  pat.full_name_ar AS patient_name,
  po.operation_date,
  po.paid_amount,
  po.doctor_share_amount,
  po.id AS operation_id
FROM public.patient_operations po
JOIN target_patients tp ON tp.patient_id = po.patient_id
JOIN public.doctors d_other ON d_other.id = po.doctor_id
JOIN public.patients pat ON pat.id = po.patient_id
WHERE po.doctor_id <> tp.target_doctor_id
  AND COALESCE(po.paid_amount, 0) > 0
ORDER BY tp.target_doctor, po.operation_date DESC
LIMIT 100;


-- ═══════════════════════════════════════════════════════════════════════════
-- 8) ملخص الأعلام — سبب الفرق لكل طبيب
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  dt.full_name_ar AS doctor_name,
  dt.expected_balance,
  (public.get_doctor_wallet_stats(dt.id) ->> 'available_balance')::numeric AS current_balance,
  ROUND((
    (public.get_doctor_wallet_stats(dt.id) ->> 'available_balance')::numeric
    - COALESCE(dt.expected_balance, 0)
  )::numeric, 2) AS gap,
  f.review_fee_leaks,
  ROUND(f.review_fee_leak_amount::numeric, 2) AS review_fee_leak_doctor_share,
  f.overbump_count,
  ROUND(f.overbump_earned::numeric, 2) AS overbump_earned_total,
  ROUND(f.balance_topups_total::numeric, 2) AS balance_topups,
  f.duplicate_groups,
  ROUND(f.duplicate_earned::numeric, 2) AS duplicate_earned_extra,
  CASE
    WHEN dt.expected_balance IS NULL THEN '—'
    WHEN ABS(
      (public.get_doctor_wallet_stats(dt.id) ->> 'available_balance')::numeric
      - dt.expected_balance
    ) < 1 THEN '✅ الرصيد يطابق المتوقع'
    WHEN f.balance_topups_total > 0
      AND ABS(
        (public.get_doctor_wallet_stats(dt.id) ->> 'available_balance')::numeric
        - dt.expected_balance - f.balance_topups_total
      ) < 1
      THEN '⚠️ الفرق ≈ شحن رصيد يدوي'
    WHEN f.review_fee_leak_amount > 0
      THEN '⚠️ كشفيات دخلت محفظة الطبيب'
    WHEN f.overbump_count > 0
      THEN '⚠️ كشفية مضاعفة محتملة'
    WHEN f.duplicate_groups > 0
      THEN '⚠️ دفعات مكررة محتملة'
    ELSE '❓ راجع القسم 2 (الدفعات)'
  END AS likely_cause
FROM _doc_target dt
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (
      WHERE COALESCE(po.review_fee_amount, 0) > 0
        AND COALESCE(po.doctor_share_amount, 0) > 0.01
        AND (
          COALESCE(po.is_review_statement, false) = true
          OR COALESCE(po.paid_amount, 0) <= COALESCE(po.review_fee_amount, 0) + 0.01
        )
    ) AS review_fee_leaks,
    COALESCE(SUM(po.doctor_share_amount) FILTER (
      WHERE COALESCE(po.review_fee_amount, 0) > 0
        AND COALESCE(po.doctor_share_amount, 0) > 0.01
        AND (
          COALESCE(po.is_review_statement, false) = true
          OR COALESCE(po.paid_amount, 0) <= COALESCE(po.review_fee_amount, 0) + 0.01
        )
    ), 0) AS review_fee_leak_amount,
    COUNT(*) FILTER (
      WHERE COALESCE(po.review_fee_amount, 0) > 0
        AND COALESCE(po.paid_amount, 0) > COALESCE(po.review_fee_amount, 0)
        AND COALESCE(po.is_review_statement, false) = true
        AND (po.paid_amount / NULLIF(po.review_fee_amount, 0)) BETWEEN 6.5 AND 7.5
    ) AS overbump_count,
    COALESCE(SUM(
      public.calc_doctor_operation_earned(
        po.doctor_id, po.doctor_share_amount, po.paid_amount, po.treatment_case_id
      )
    ) FILTER (
      WHERE COALESCE(po.review_fee_amount, 0) > 0
        AND COALESCE(po.paid_amount, 0) > COALESCE(po.review_fee_amount, 0)
        AND COALESCE(po.is_review_statement, false) = true
        AND (po.paid_amount / NULLIF(po.review_fee_amount, 0)) BETWEEN 6.5 AND 7.5
    ), 0) AS overbump_earned,
    (
      SELECT COALESCE(SUM(amount), 0)
      FROM public.transactions t
      WHERE t.doctor_id = dt.id
        AND t.type = 'balance_topup_doctor' AND t.amount > 0
    ) AS balance_topups_total,
    (
      SELECT COUNT(*) FROM (
        SELECT 1
        FROM public.patient_operations po2
        JOIN public.patients pat ON pat.id = po2.patient_id
        WHERE po2.doctor_id = dt.id
          AND COALESCE(po2.paid_amount, 0) > 0
        GROUP BY po2.operation_date, pat.full_name_ar, po2.paid_amount, po2.doctor_share_amount
        HAVING COUNT(*) > 1
      ) dup
    ) AS duplicate_groups,
    (
      SELECT COALESCE(SUM(extra), 0) FROM (
        SELECT
          (COUNT(*) - 1) * MAX(public.calc_doctor_operation_earned(
            po2.doctor_id, po2.doctor_share_amount, po2.paid_amount, po2.treatment_case_id
          )) AS extra
        FROM public.patient_operations po2
        JOIN public.patients pat ON pat.id = po2.patient_id
        WHERE po2.doctor_id = dt.id
          AND COALESCE(po2.paid_amount, 0) > 0
        GROUP BY po2.operation_date, pat.full_name_ar, po2.paid_amount, po2.doctor_share_amount
        HAVING COUNT(*) > 1
      ) dup
    ) AS duplicate_earned
  FROM public.patient_operations po
  WHERE po.doctor_id = dt.id
    AND COALESCE(po.paid_amount, 0) > 0
) f ON TRUE
ORDER BY dt.full_name_ar;
