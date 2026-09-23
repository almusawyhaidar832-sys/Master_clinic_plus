-- =============================================================================
-- 70) تشخيص محاسبي كامل — عيادة الحلو
-- قراءة فقط: لا يعدّل ولا يحذف أي بيانات.
-- شغّله في Supabase → SQL Editor. النتيجة جدول واحد مرتّب بالأقسام:
--   القسم | البند | القيمة | المتوقع | الفرق | ملاحظة
-- أي سطر فيه «الفرق» ≠ 0 هو مكان مشكلة.
-- =============================================================================

WITH
clinic AS (
  SELECT c.id
  FROM public.clinics c
  WHERE c.name_ar ILIKE '%الحلو%'
  ORDER BY c.created_at
  LIMIT 1
),

doctors AS (
  SELECT
    d.id,
    d.full_name_ar AS name,
    COALESCE(d.payment_type::text, 'percentage') AS payment_type,
    CASE
      WHEN p.v IS NULL THEN 0
      WHEN p.v <= 1 THEN p.v * 100
      ELSE p.v
    END AS pct,
    CASE
      WHEN m.v IS NULL THEN 0
      WHEN m.v <= 1 THEN m.v * 100
      ELSE m.v
    END AS materials_pct
  FROM public.doctors d
  JOIN clinic c ON c.id = d.clinic_id
  CROSS JOIN LATERAL (
    SELECT NULLIF(regexp_replace(COALESCE(d.percentage::text, ''), '[^0-9.]', '', 'g'), '')::numeric AS v
  ) p
  CROSS JOIN LATERAL (
    SELECT NULLIF(regexp_replace(COALESCE(d.materials_share::text, ''), '[^0-9.]', '', 'g'), '')::numeric AS v
  ) m
),

ops AS (
  SELECT
    po.id,
    po.doctor_id,
    po.patient_id,
    po.treatment_case_id,
    po.operation_date,
    po.created_at,
    po.session_kind,
    COALESCE(po.paid_amount, 0)          AS paid,
    COALESCE(po.review_fee_amount, 0)    AS review_fee,
    COALESCE(po.is_review_statement, FALSE) AS is_review,
    COALESCE(po.materials_cost, 0)       AS materials,
    po.doctor_share_amount               AS doc_share,
    po.clinic_share_amount               AS clinic_share,
    (
      COALESCE(po.operation_name_ar, '') ILIKE '%تسجيل دين%'
      OR COALESCE(po.notes, '') LIKE '%__debt_amount:%'
    ) AS is_debt_reg,
    (po.session_kind = 'refund' OR COALESCE(po.paid_amount, 0) < 0) AS is_refund
  FROM public.patient_operations po
  JOIN clinic c ON c.id = po.clinic_id
),

-- حصة الطبيب المتوقعة بنسبته الحالية (نفس صيغة trigger الدفعة) — للمقارنة فقط
ops_expected AS (
  SELECT
    o.*,
    d.name AS doctor_name,
    d.pct,
    d.payment_type,
    CASE
      WHEN o.is_refund OR o.is_debt_reg OR o.paid <= 0 THEN NULL
      WHEN d.payment_type = 'salary' THEN 0
      WHEN o.review_fee > 0 AND o.paid <= o.review_fee THEN 0
      WHEN o.is_review AND o.review_fee <= 0 THEN 0
      ELSE ROUND(GREATEST(0,
        (CASE WHEN o.review_fee > 0 AND o.paid > o.review_fee
              THEN o.paid - o.review_fee ELSE o.paid END) * d.pct / 100
        - o.materials * d.materials_pct / 100
      ), 2)
    END AS expected_doc_share
  FROM ops o
  LEFT JOIN doctors d ON d.id = o.doctor_id
),

cases AS (
  SELECT ptc.id, ptc.primary_doctor_id
  FROM public.patient_treatment_cases ptc
  JOIN clinic c ON c.id = ptc.clinic_id
),

tx AS (
  SELECT
    t.id, t.type, t.amount, t.doctor_id, t.transaction_date, t.created_at,
    t.reference_type, t.reference_id::text AS reference_id, t.description_ar
  FROM public.transactions t
  JOIN clinic c ON c.id = t.clinic_id
),

assistants AS (
  SELECT
    a.id, a.full_name_ar AS name, a.doctor_id,
    COALESCE(a.doctor_share_percentage, 0) AS doc_pct
  FROM public.assistants a
  JOIN clinic c ON c.id = a.clinic_id
),

entries AS (
  SELECT se.id::text AS id, se.assistant_id, se.amount, se.entry_date
  FROM public.salary_entries se
  JOIN clinic c ON c.id = se.clinic_id
  WHERE se.entry_type = 'daily_wage' AND se.assistant_id IS NOT NULL
),

records AS (
  SELECT pr.id::text AS id, pr.assistant_id
  FROM public.payroll_records pr
  JOIN clinic c ON c.id = pr.clinic_id
),

daily_confirmed AS (
  SELECT DISTINCT reference_id AS entry_id
  FROM tx
  WHERE reference_type IN ('salary_entry_assistant_doctor', 'salary_entry_assistant_clinic')
),

-- المجاميع الأساسية
totals AS (
  SELECT
    COUNT(*)                                                          AS op_count,
    COALESCE(SUM(paid) FILTER (WHERE paid > 0 AND NOT is_debt_reg), 0) AS paid_pos,
    COALESCE(SUM(paid) FILTER (WHERE is_refund), 0)                   AS refunds,
    COUNT(*) FILTER (WHERE is_refund)                                 AS refund_count,
    COALESCE(SUM(doc_share) FILTER (WHERE NOT is_debt_reg), 0)        AS doc_frozen,
    COALESCE(SUM(clinic_share) FILTER (WHERE NOT is_debt_reg), 0)     AS clinic_frozen,
    COUNT(*) FILTER (WHERE paid > 0 AND doc_share IS NULL)            AS null_share_count,
    COUNT(*) FILTER (
      WHERE paid <> 0 AND NOT is_debt_reg AND doc_share IS NOT NULL
        AND ABS(COALESCE(doc_share, 0) + COALESCE(clinic_share, 0) - paid) > 0.01
    )                                                                 AS split_mismatch_count,
    COALESCE(SUM(COALESCE(doc_share, 0) + COALESCE(clinic_share, 0) - paid) FILTER (
      WHERE paid <> 0 AND NOT is_debt_reg AND doc_share IS NOT NULL
        AND ABS(COALESCE(doc_share, 0) + COALESCE(clinic_share, 0) - paid) > 0.01
    ), 0)                                                             AS split_mismatch_sum,
    COUNT(*) FILTER (WHERE is_debt_reg)                               AS debt_reg_count,
    COALESCE(SUM(COALESCE(doc_share, 0)) FILTER (WHERE is_debt_reg), 0) AS debt_reg_doc_share,
    COUNT(*) FILTER (
      WHERE to_char(created_at AT TIME ZONE 'Asia/Baghdad', 'YYYY-MM')
            <> to_char(operation_date, 'YYYY-MM')
    )                                                                 AS month_mismatch
  FROM ops
),

topups AS (
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0) AS total_sum,
    COUNT(*) FILTER (WHERE amount > 0)                 AS cnt
  FROM tx WHERE type = 'balance_topup_clinic'
),
topups_max_per_day AS (
  SELECT COALESCE(SUM(mx), 0) AS total
  FROM (
    SELECT transaction_date, MAX(amount) AS mx
    FROM tx WHERE type = 'balance_topup_clinic' AND amount > 0
    GROUP BY transaction_date
  ) s
),

profit AS (
  SELECT
    (SELECT clinic_frozen FROM totals) AS clinic_share,
    (SELECT COALESCE(SUM(e.amount), 0)
       FROM public.expenses e JOIN clinic c ON c.id = e.clinic_id
      WHERE COALESCE(e.expense_kind, 'general') <> 'doctor_salary') AS general_expenses,
    (SELECT GREATEST(0, -COALESCE(SUM(amount), 0))
       FROM tx WHERE type = 'doctor_expense_clinic') AS clinic_part_of_doctor_expenses,
    (SELECT -COALESCE(SUM(amount), 0)
       FROM tx WHERE type IN ('staff_salary_paid', 'assistant_payroll_clinic', 'doctor_salary_paid')) AS payroll,
    (SELECT total_sum FROM topups) AS topups
),

per_doctor AS (
  SELECT
    d.id, d.name, d.pct, d.payment_type,
    COUNT(o.id)                                                          AS ops,
    COALESCE(SUM(o.doc_share) FILTER (WHERE NOT o.is_debt_reg), 0)       AS frozen,
    COALESCE(SUM(COALESCE(o.expected_doc_share, o.doc_share))
             FILTER (WHERE NOT o.is_debt_reg), 0)                        AS expected_now,
    COUNT(*) FILTER (
      WHERE o.expected_doc_share IS NOT NULL
        AND ABS(COALESCE(o.doc_share, 0) - o.expected_doc_share) > 0.01
    )                                                                    AS ops_diff_count
  FROM doctors d
  LEFT JOIN ops_expected o ON o.doctor_id = d.id
  GROUP BY d.id, d.name, d.pct, d.payment_type
),

wrong_case_doctor AS (
  SELECT
    COALESCE(d.name, '؟') AS op_doctor,
    COALESCE(pd.name, '؟') AS case_doctor,
    COUNT(*) AS cnt,
    SUM(o.paid) AS paid,
    SUM(COALESCE(o.doc_share, 0)) AS doc_share
  FROM ops o
  JOIN cases cs ON cs.id = o.treatment_case_id
  LEFT JOIN doctors d  ON d.id  = o.doctor_id
  LEFT JOIN doctors pd ON pd.id = cs.primary_doctor_id
  WHERE cs.primary_doctor_id IS NOT NULL
    AND cs.primary_doctor_id <> o.doctor_id
    AND o.paid <> 0
  GROUP BY 1, 2
),

wallet AS (
  SELECT
    pd.id, pd.name, pd.frozen AS earnings,
    COALESCE((SELECT SUM(w.amount) FROM public.doctor_withdrawals w
               WHERE w.doctor_id = pd.id AND w.status IN ('paid', 'approved')), 0) AS withdrawn,
    COALESCE((SELECT SUM(w.amount) FROM public.doctor_withdrawals w
               WHERE w.doctor_id = pd.id AND w.status = 'pending'), 0) AS pending_withdrawals,
    GREATEST(0, -COALESCE((SELECT SUM(amount) FROM tx
               WHERE tx.doctor_id = pd.id AND type = 'doctor_expense_doctor'), 0)) AS expense_deduction,
    GREATEST(0, -COALESCE((SELECT SUM(amount) FROM tx
               WHERE tx.doctor_id = pd.id AND type = 'assistant_payroll_doctor'), 0)) AS assistant_deduction,
    COALESCE((SELECT SUM(amount) FROM tx
               WHERE tx.doctor_id = pd.id AND type = 'balance_topup_doctor' AND amount > 0), 0) AS topups
  FROM per_doctor pd
  WHERE pd.payment_type <> 'salary'
),

assistant_by_doctor AS (
  SELECT
    d.id, d.name,
    COALESCE(SUM(e.amount), 0) AS wages_total,
    COALESCE(SUM(ROUND(e.amount * a.doc_pct / 100, 2)), 0) AS expected_doctor_part,
    COALESCE(SUM(e.amount) FILTER (WHERE dc.entry_id IS NULL), 0) AS wages_not_daily_confirmed
  FROM doctors d
  JOIN assistants a ON a.doctor_id = d.id
  LEFT JOIN entries e ON e.assistant_id = a.id
  LEFT JOIN daily_confirmed dc ON dc.entry_id = e.id
  GROUP BY d.id, d.name
),

assistant_tx_by_doctor AS (
  SELECT
    doctor_id,
    -COALESCE(SUM(amount), 0) AS net_deduction,
    -COALESCE(SUM(amount) FILTER (WHERE reference_type = 'salary_entry_assistant_doctor'), 0) AS via_daily,
    -COALESCE(SUM(amount) FILTER (WHERE reference_type = 'payroll_record_paid'), 0) AS via_monthly,
    COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0) AS corrections
  FROM tx
  WHERE type = 'assistant_payroll_doctor'
  GROUP BY doctor_id
),

orphan_confirms AS (
  SELECT COUNT(*) AS cnt, COALESCE(SUM(t.amount), 0) AS amt
  FROM tx t
  WHERE t.reference_type IN ('salary_entry_assistant_doctor', 'salary_entry_assistant_clinic')
    AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.id = t.reference_id)
),

bad_monthly_refs AS (
  SELECT COUNT(*) AS cnt
  FROM tx t
  WHERE t.reference_type IN ('payroll_record_paid', 'payroll_record_clinic_paid')
    AND NOT EXISTS (
      SELECT 1 FROM records r WHERE r.id = split_part(t.reference_id, ':from:', 1)
    )
),

dup_tx AS (
  SELECT type, amount, transaction_date, doctor_id, reference_type, reference_id, COUNT(*) AS cnt
  FROM tx
  GROUP BY type, amount, transaction_date, doctor_id, reference_type, reference_id
  HAVING COUNT(*) > 1
),

report AS (
  -- ── 1) نظرة عامة على الجلسات ──────────────────────────────────────────────
  SELECT 1 AS s, 1 AS o, '1) الجلسات' AS section, 'عدد الجلسات الكلي' AS item,
         t.op_count::numeric AS value, 1000::numeric AS expected, NULL::numeric AS diff,
         CASE WHEN t.op_count > 1000
              THEN 'أكثر من 1000 → النسخة القديمة من البرنامج كانت تُسقط جلسات من ربح العيادة'
              ELSE 'أقل من 1000 — لا مشكلة حد الصفوف' END AS note
  FROM totals t
  UNION ALL
  SELECT 1, 2, '1) الجلسات', 'مجموع المدفوع (موجب، بدون تسجيل دين)', t.paid_pos, NULL, NULL, NULL FROM totals t
  UNION ALL
  SELECT 1, 3, '1) الجلسات', 'مجموع الإرجاعات', t.refunds, NULL, NULL,
         t.refund_count || ' قيد إرجاع — النسخة القديمة لم تطرحها من المحصّل' FROM totals t
  UNION ALL
  SELECT 1, 4, '1) الجلسات', 'صافي المحصّل (بعد الإرجاعات)', t.paid_pos + t.refunds, NULL, NULL, NULL FROM totals t
  UNION ALL
  SELECT 1, 5, '1) الجلسات', 'مجموع حصص الأطباء المجمّدة', t.doc_frozen, NULL, NULL, 'هذا الرقم الصحيح لأرباح الأطباء' FROM totals t
  UNION ALL
  SELECT 1, 6, '1) الجلسات', 'مجموع حصص العيادة المجمّدة', t.clinic_frozen, NULL, NULL, NULL FROM totals t
  UNION ALL
  SELECT 1, 7, '1) الجلسات', 'جلسات مدفوعة بدون حصة طبيب مجمّدة', t.null_share_count, 0, t.null_share_count, NULL FROM totals t
  UNION ALL
  SELECT 1, 8, '1) الجلسات', 'جلسات حصة الطبيب + العيادة ≠ المدفوع', t.split_mismatch_count, 0, t.split_mismatch_sum,
         'الفرق = مجموع (حصة طبيب + حصة عيادة − المدفوع)' FROM totals t
  UNION ALL
  SELECT 1, 9, '1) الجلسات', 'جلسات تسجيل دين', t.debt_reg_count, NULL, t.debt_reg_doc_share,
         'الفرق = حصة طبيب مسجّلة على تسجيل دين (يجب 0)' FROM totals t
  UNION ALL
  SELECT 1, 10, '1) الجلسات', 'جلسات شهر الإنشاء ≠ شهر العملية', t.month_mismatch, 0, t.month_mismatch,
         'قد تظهر بشهرين مختلفين في التقارير الشهرية' FROM totals t

  -- ── 2) أرباح كل طبيب ─────────────────────────────────────────────────────
  UNION ALL
  SELECT 2, 1, '2) أرباح الأطباء', pd.name || ' — الحصة المجمّدة (المحفظة)',
         pd.frozen, pd.expected_now, ROUND(pd.frozen - pd.expected_now, 2),
         'نسبته الحالية ' || pd.pct || '% | ' || pd.ops || ' جلسة | '
         || pd.ops_diff_count || ' جلسة حصتها ≠ النسبة الحالية'
         || CASE WHEN pd.ops > 1000 THEN ' | ⚠ أكثر من 1000 جلسة' ELSE '' END
  FROM per_doctor pd
  UNION ALL
  SELECT 2, 2, '2) أرباح الأطباء',
         'جلسة طبيبها ≠ طبيب الحالة: ' || w.op_doctor || ' (الحالة لـ ' || w.case_doctor || ')',
         w.cnt, 0, w.doc_share,
         'المدفوع ' || w.paid || ' — النسخة القديمة لشاشة الربح نسبتها لطبيب الحالة بالخطأ'
  FROM wrong_case_doctor w

  -- ── 3) محفظة كل طبيب ─────────────────────────────────────────────────────
  UNION ALL
  SELECT 3, 1, '3) المحافظ', w.name || ' — الرصيد',
         ROUND(w.earnings - w.withdrawn - w.expense_deduction - w.assistant_deduction + w.topups, 2),
         NULL, NULL,
         'أرباح ' || w.earnings || ' − سحب ' || w.withdrawn || ' − صرفيات ' || w.expense_deduction
         || ' − مساعدين ' || w.assistant_deduction || ' + شحن ' || w.topups
         || ' | سحب معلّق ' || w.pending_withdrawals
  FROM wallet w

  -- ── 4) المساعدين ─────────────────────────────────────────────────────────
  UNION ALL
  SELECT 4, 1, '4) المساعدين', ab.name || ' — صافي الخصم من الطبيب',
         COALESCE(at.net_deduction, 0), ab.expected_doctor_part,
         ROUND(COALESCE(at.net_deduction, 0) - ab.expected_doctor_part, 2),
         'أجور مسجّلة ' || ab.wages_total
         || ' | غير مؤكّدة يومياً ' || ab.wages_not_daily_confirmed
         || ' | عبر تأكيد يومي ' || COALESCE(at.via_daily, 0)
         || ' | عبر تأكيد شهري قديم ' || COALESCE(at.via_monthly, 0)
         || ' | تصحيحات (استرجاع) ' || COALESCE(at.corrections, 0)
         || ' — الفرق السالب = أجور لم يُؤكَّد صرفها بعد'
  FROM assistant_by_doctor ab
  LEFT JOIN assistant_tx_by_doctor at ON at.doctor_id = ab.id
  UNION ALL
  SELECT 4, 2, '4) المساعدين', 'مجموع خصم الأطباء مقابل خصم العيادة',
         (SELECT -COALESCE(SUM(amount), 0) FROM tx WHERE type = 'assistant_payroll_doctor'),
         (SELECT -COALESCE(SUM(amount), 0) FROM tx WHERE type = 'assistant_payroll_clinic'),
         (SELECT -COALESCE(SUM(amount), 0) FROM tx WHERE type = 'assistant_payroll_doctor')
         - (SELECT -COALESCE(SUM(amount), 0) FROM tx WHERE type = 'assistant_payroll_clinic'),
         'بنسبة 50% يجب أن يتساويا'
  UNION ALL
  SELECT 4, 3, '4) المساعدين', 'تأكيدات يومية لأجر محذوف (يتيمة)', oc.cnt, 0, oc.amt, NULL FROM orphan_confirms oc
  UNION ALL
  SELECT 4, 4, '4) المساعدين', 'تأكيدات شهرية بلا سجل راتب', bm.cnt, 0, bm.cnt, NULL FROM bad_monthly_refs bm

  -- ── 5) شحن رصيد العيادة ──────────────────────────────────────────────────
  UNION ALL
  SELECT 5, 1, '5) الشحن', 'مجموع شحن رصيد العيادة (كل الشحنات)', tp.total_sum, mx.total,
         tp.total_sum - mx.total,
         'المتوقع = طريقة النسخة القديمة (أكبر شحن لكل يوم) — الفرق كان ضائعاً من الربح'
  FROM topups tp, topups_max_per_day mx
  UNION ALL
  SELECT 5, 2, '5) الشحن', 'شحن ' || t.transaction_date || ' — ' || COALESCE(t.description_ar, ''),
         t.amount, NULL, NULL,
         'أُنشئ ' || to_char(t.created_at AT TIME ZONE 'Asia/Baghdad', 'YYYY-MM-DD HH24:MI')
  FROM tx t WHERE t.type = 'balance_topup_clinic' AND t.amount > 0

  -- ── 6) حركات مكررة ───────────────────────────────────────────────────────
  UNION ALL
  SELECT 6, 1, '6) حركات مكررة', d.type || ' ' || d.transaction_date || ' مرجع ' || COALESCE(d.reference_type, '-'),
         d.amount, NULL, d.cnt - 1, 'مكررة ' || d.cnt || ' مرات'
  FROM dup_tx d
  UNION ALL
  SELECT 6, 2, '6) حركات مكررة', 'عدد مجموعات الحركات المكررة',
         (SELECT COUNT(*) FROM dup_tx), 0, (SELECT COUNT(*) FROM dup_tx), NULL

  -- ── 7) إعادة بناء صافي ربح العيادة ───────────────────────────────────────
  UNION ALL
  SELECT 7, 1, '7) صافي الربح', 'حصة العيادة من الجلسات', p.clinic_share, NULL, NULL, NULL FROM profit p
  UNION ALL
  SELECT 7, 2, '7) صافي الربح', 'صرفيات العيادة', -p.general_expenses, NULL, NULL, NULL FROM profit p
  UNION ALL
  SELECT 7, 3, '7) صافي الربح', 'حصة العيادة من صرفيات الأطباء', -p.clinic_part_of_doctor_expenses, NULL, NULL, NULL FROM profit p
  UNION ALL
  SELECT 7, 4, '7) صافي الربح', 'رواتب وأجور مساعدين مؤكَّد صرفها', -p.payroll, NULL, NULL, NULL FROM profit p
  UNION ALL
  SELECT 7, 5, '7) صافي الربح', 'شحن رصيد العيادة', p.topups, NULL, NULL, NULL FROM profit p
  UNION ALL
  SELECT 7, 6, '7) صافي الربح', 'صافي ربح العيادة (من البداية)',
         ROUND(p.clinic_share - p.general_expenses - p.clinic_part_of_doctor_expenses - p.payroll + p.topups, 2),
         352500.01,
         ROUND(p.clinic_share - p.general_expenses - p.clinic_part_of_doctor_expenses - p.payroll + p.topups, 2) - 352500.01,
         'المتوقع = رقم البرنامج بعد التصليح (يوم 2026-09-23). النسخة القديمة كانت تعرض 151500.01'
  FROM profit p
)

SELECT
  section  AS "القسم",
  item     AS "البند",
  ROUND(value, 2)    AS "القيمة",
  ROUND(expected, 2) AS "المتوقع",
  ROUND(diff, 2)     AS "الفرق",
  note     AS "ملاحظة"
FROM report
ORDER BY s, o, item;
