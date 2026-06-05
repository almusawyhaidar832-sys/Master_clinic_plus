-- إعادة ربط وتصحيح الحالات بعد تشغيل link-operations-to-treatment-cases.sql
-- شغّل هذا إذا الحالات ما زالت تظهر «مكتملة» بالخطأ

-- فك ربط خاطئ
UPDATE public.patient_operations po
SET treatment_case_id = NULL
FROM public.patient_treatment_cases c
WHERE po.treatment_case_id = c.id
  AND po.patient_id = c.patient_id
  AND lower(trim(coalesce(nullif(trim(po.operation_name_ar), ''), 'علاج')))
    <> lower(trim(c.treatment_name_ar));

ALTER TABLE public.patient_operations DISABLE TRIGGER USER;

UPDATE public.patient_operations po
SET treatment_case_id = match.case_id
FROM (
  SELECT DISTINCT ON (po2.id)
    po2.id AS op_id,
    c.id AS case_id
  FROM public.patient_operations po2
  INNER JOIN public.patient_treatment_cases c
    ON po2.patient_id = c.patient_id
  WHERE lower(trim(coalesce(nullif(trim(po2.operation_name_ar), ''), 'علاج')))
    = lower(trim(c.treatment_name_ar))
  ORDER BY po2.id, c.created_at ASC
) AS match
WHERE po.id = match.op_id;

ALTER TABLE public.patient_operations ENABLE TRIGGER USER;

UPDATE public.patient_treatment_cases c
SET
  total_paid = sub.corrected_paid,
  status = CASE
    WHEN sub.corrected_paid >= c.final_price - 0.01
      AND c.final_price > 0
      AND sub.plan_remaining <= 0.01
    THEN 'completed'
    ELSE 'active'
  END,
  updated_at = NOW()
FROM (
  SELECT
    c2.id AS case_id,
    COALESCE((
      SELECT GREATEST(
        0,
        COALESCE(po3.remaining_debt, po3.total_amount - po3.paid_amount)
      )
      FROM public.patient_operations po3
      WHERE po3.treatment_case_id = c2.id
        AND COALESCE(po3.total_amount, 0) > 0
      ORDER BY po3.created_at DESC
      LIMIT 1
    ), 0) AS plan_remaining,
    CASE
      WHEN COALESCE(SUM(po.paid_amount), 0) >= c2.final_price - 0.01
        AND c2.final_price > 0
        AND COALESCE((
          SELECT GREATEST(
            0,
            COALESCE(po3.remaining_debt, po3.total_amount - po3.paid_amount)
          )
          FROM public.patient_operations po3
          WHERE po3.treatment_case_id = c2.id
            AND COALESCE(po3.total_amount, 0) > 0
          ORDER BY po3.created_at DESC
          LIMIT 1
        ), 0) > 0.01
      THEN GREATEST(
        0,
        c2.final_price - COALESCE((
          SELECT GREATEST(
            0,
            COALESCE(po3.remaining_debt, po3.total_amount - po3.paid_amount)
          )
          FROM public.patient_operations po3
          WHERE po3.treatment_case_id = c2.id
            AND COALESCE(po3.total_amount, 0) > 0
          ORDER BY po3.created_at DESC
          LIMIT 1
        ), 0)
      )
      ELSE LEAST(COALESCE(SUM(po.paid_amount), 0), c2.final_price)
    END AS corrected_paid
  FROM public.patient_treatment_cases c2
  LEFT JOIN public.patient_operations po ON po.treatment_case_id = c2.id
  GROUP BY c2.id, c2.final_price
) sub
WHERE c.id = sub.case_id;

UPDATE public.patient_treatment_cases
SET status = 'active', updated_at = NOW()
WHERE status = 'completed'
  AND final_price > total_paid + 0.01;

SELECT id, treatment_name_ar, final_price, total_paid,
       GREATEST(0, final_price - total_paid) AS remaining,
       status
FROM public.patient_treatment_cases
WHERE status = 'active' OR final_price > total_paid + 0.01
ORDER BY updated_at DESC
LIMIT 30;
