-- تعبئة حصص الجلسات المدفوعة حسب نسبة كل طبيب (0–100) — الكشفية للعيادة

UPDATE public.patient_operations po
SET
  doctor_share_amount = sub.doc_share,
  clinic_share_amount = sub.clinic_share
FROM (
  SELECT
    po2.id,
    ROUND(
      CASE
        WHEN COALESCE(NULLIF(d.payment_type, ''), 'percentage') = 'salary' THEN 0
        WHEN COALESCE(po2.is_review_statement, FALSE) THEN 0
        WHEN COALESCE(po2.review_fee_amount, 0) > 0
             AND COALESCE(po2.paid_amount, 0)
                 <= COALESCE(po2.review_fee_amount, 0) + 0.01 THEN 0
        ELSE GREATEST(
          0,
          (
            COALESCE(po2.paid_amount, 0)
            - CASE
                WHEN COALESCE(po2.review_fee_amount, 0) > 0
                     AND COALESCE(po2.paid_amount, 0)
                         > COALESCE(po2.review_fee_amount, 0)
                  THEN COALESCE(po2.review_fee_amount, 0)
                ELSE 0
              END
          ) * (COALESCE((d.percentage::TEXT)::NUMERIC, 50) / 100)
          - COALESCE(po2.materials_cost, 0)
            * (COALESCE((d.materials_share::TEXT)::NUMERIC, 0) / 100)
        )
      END,
      2
    ) AS doc_share,
    ROUND(
      GREATEST(
        0,
        COALESCE(po2.paid_amount, 0)
        - CASE
            WHEN COALESCE(NULLIF(d.payment_type, ''), 'percentage') = 'salary' THEN 0
            WHEN COALESCE(po2.is_review_statement, FALSE) THEN 0
            WHEN COALESCE(po2.review_fee_amount, 0) > 0
                 AND COALESCE(po2.paid_amount, 0)
                     <= COALESCE(po2.review_fee_amount, 0) + 0.01 THEN 0
            ELSE GREATEST(
              0,
              (
                COALESCE(po2.paid_amount, 0)
                - CASE
                    WHEN COALESCE(po2.review_fee_amount, 0) > 0
                         AND COALESCE(po2.paid_amount, 0)
                             > COALESCE(po2.review_fee_amount, 0)
                      THEN COALESCE(po2.review_fee_amount, 0)
                    ELSE 0
                  END
              ) * (COALESCE((d.percentage::TEXT)::NUMERIC, 50) / 100)
              - COALESCE(po2.materials_cost, 0)
                * (COALESCE((d.materials_share::TEXT)::NUMERIC, 0) / 100)
            )
          END
      ),
      2
    ) AS clinic_share
  FROM public.patient_operations po2
  JOIN public.doctors d ON d.id = po2.doctor_id
  WHERE COALESCE(po2.paid_amount, 0) > 0
) sub
WHERE po.id = sub.id;

NOTIFY pgrst, 'reload schema';
