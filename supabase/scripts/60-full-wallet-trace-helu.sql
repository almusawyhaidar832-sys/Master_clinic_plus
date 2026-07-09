-- =============================================================================
-- تتبّع كامل لرصيد محفظة حارث وسجاد (عيادة الحلو) — بعد تشغيل سكربت 58
-- شغّله في Supabase → SQL Editor وارسل لي كل نتائج الأقسام 1 إلى 5 كاملة
-- بدون أي تعديل بيانات — قراءة فقط
-- =============================================================================

CREATE TEMP TABLE _helu60 AS
SELECT c.id AS clinic_id, c.name_ar AS clinic_name
FROM public.clinics c
WHERE c.name_ar ILIKE '%الحلو%';

CREATE TEMP TABLE _docs60 AS
SELECT d.id AS doctor_id, d.full_name_ar AS doctor_name, d.percentage, d.payment_type,
       d.materials_share, d.clinic_id
FROM public.doctors d
JOIN _helu60 c ON c.clinic_id = d.clinic_id
WHERE d.full_name_ar ILIKE '%سجاد%' OR d.full_name_ar ILIKE '%حارث%';

-- ═══════════════════════════════════════════════════════════════════════════
-- 0) بيانات الطبيب الحالية (نسبة، نوع دفع) — تأكد فقط
-- ═══════════════════════════════════════════════════════════════════════════
SELECT * FROM _docs60;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) كل عملية (patient_operations) لكل طبيب — بالترتيب الزمني، مع حساب
--    "الحصة الصحيحة" بصيغة trigger الجديد ومجموع تراكمي للحصة المخزّنة
--    والحصة الصحيحة، لمعرفة أين يبدأ الانحراف بالضبط
-- ═══════════════════════════════════════════════════════════════════════════
WITH ops AS (
  SELECT
    po.id,
    dd.doctor_name,
    po.operation_date,
    po.created_at,
    po.session_kind,
    po.paid_amount,
    po.review_fee_amount,
    po.is_review_statement,
    po.materials_cost,
    po.treatment_case_id,
    po.doctor_share_amount AS stored_doc_share,
    po.clinic_share_amount AS stored_clinic_share,
    dd.percentage AS doctor_pct_now,
    dd.payment_type,
    CASE
      WHEN po.session_kind = 'refund' THEN COALESCE(po.doctor_share_amount, 0)
      WHEN COALESCE(NULLIF(dd.payment_type, ''), 'percentage') = 'salary' THEN 0
      WHEN po.paid_amount > 0 AND (
        (COALESCE(po.review_fee_amount, 0) > 0 AND po.paid_amount <= COALESCE(po.review_fee_amount, 0) + 0.01)
        OR (
          COALESCE(po.is_review_statement, FALSE)
          AND COALESCE(po.review_fee_amount, 0) <= 0
          AND po.treatment_case_id IS NULL
        )
      ) THEN 0
      WHEN po.paid_amount > 0 THEN
        ROUND(
          GREATEST(
            0,
            (
              po.paid_amount - CASE
                WHEN COALESCE(po.review_fee_amount, 0) > 0 AND po.paid_amount > COALESCE(po.review_fee_amount, 0)
                  THEN COALESCE(po.review_fee_amount, 0)
                ELSE 0
              END
            ) * COALESCE((dd.percentage::TEXT)::NUMERIC, 50) / 100
            - COALESCE(po.materials_cost, 0) * COALESCE((dd.materials_share::TEXT)::NUMERIC, 0) / 100
          ),
          2
        )
      ELSE 0
    END AS correct_doc_share_now_pct
  FROM public.patient_operations po
  JOIN _docs60 dd ON dd.doctor_id = po.doctor_id
)
SELECT
  doctor_name,
  operation_date,
  created_at,
  session_kind,
  paid_amount,
  review_fee_amount,
  is_review_statement,
  materials_cost,
  doctor_pct_now,
  payment_type,
  stored_doc_share,
  correct_doc_share_now_pct,
  ROUND(stored_doc_share - correct_doc_share_now_pct, 2) AS diff_vs_current_pct,
  ROUND(SUM(stored_doc_share) OVER (PARTITION BY doctor_name ORDER BY operation_date, created_at), 2) AS running_stored_total,
  id AS operation_id
FROM ops
ORDER BY doctor_name, operation_date, created_at;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) إجمالي الحصص المخزّنة فعلياً (كما تقرأها get_doctor_wallet_stats) لكل
--    طبيب — هذا هو "total_earnings" المستخدَم في حساب الرصيد
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  dd.doctor_name,
  COUNT(po.id) AS op_count,
  ROUND(SUM(COALESCE(po.doctor_share_amount, 0)), 2) AS sum_stored_doctor_share,
  ROUND(SUM(COALESCE(po.paid_amount, 0)), 2) AS sum_paid_amount
FROM _docs60 dd
LEFT JOIN public.patient_operations po ON po.doctor_id = dd.doctor_id
GROUP BY dd.doctor_name;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) كل السحوبات (doctor_withdrawals) لكل طبيب — بكل الحالات
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  dd.doctor_name,
  dw.id,
  dw.amount,
  dw.status,
  dw.requested_at,
  dw.processed_at
FROM _docs60 dd
JOIN public.doctor_withdrawals dw ON dw.doctor_id = dd.doctor_id
ORDER BY dd.doctor_name, dw.requested_at;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) خصومات / إضافات transactions المؤثرة على المحفظة (مصاريف طبيب، أجور
--    مساعدين، شحن رصيد)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  dd.doctor_name,
  t.id,
  t.type,
  t.amount,
  t.transaction_date,
  t.description_ar
FROM _docs60 dd
JOIN public.transactions t ON t.doctor_id = dd.doctor_id
WHERE t.type IN (
  'doctor_expense_doctor',
  'assistant_payroll_doctor',
  'balance_topup_doctor',
  'doctor_salary_paid'
)
ORDER BY dd.doctor_name, t.transaction_date;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) الرصيد النهائي كما تحسبه القاعدة الآن فعلياً (بعد سكربت 58) — نفس
--    الدالة اللي يستخدمها كل من التطبيق و RPC
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  dd.doctor_name,
  public.get_doctor_wallet_stats(dd.doctor_id) AS wallet_stats_rpc
FROM _docs60 dd;

DROP TABLE _helu60;
DROP TABLE _docs60;
