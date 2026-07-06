-- إصلاح جلسات علاج + كشفية: paid_amount كان مبلغ العلاج فقط (50,000) والكشفية تُضاف فوقه (+5,000)
-- يصحّح المدفوع الكلي والحصص (مثلاً حارث 40% من 50,000 = 20,000 وليس 18,000)

UPDATE public.patient_operations po
SET
  paid_amount = sub.new_paid,
  doctor_share_amount = sub.doc_share,
  clinic_share_amount = sub.clinic_share
FROM (
  SELECT
    po2.id,
    ROUND(COALESCE(po2.paid_amount, 0) + COALESCE(po2.review_fee_amount, 0), 2) AS new_paid,
    ROUND(
      GREATEST(
        0,
        COALESCE(po2.paid_amount, 0)
        - COALESCE(po2.materials_cost, 0)
          * (COALESCE((d.materials_share::TEXT)::NUMERIC, 0) / 100)
      ) * (COALESCE((d.percentage::TEXT)::NUMERIC, 50) / 100),
      2
    ) AS doc_share,
    ROUND(
      COALESCE(po2.paid_amount, 0)
      + COALESCE(po2.review_fee_amount, 0)
      - GREATEST(
        0,
        COALESCE(po2.paid_amount, 0)
        - COALESCE(po2.materials_cost, 0)
          * (COALESCE((d.materials_share::TEXT)::NUMERIC, 0) / 100)
      ) * (COALESCE((d.percentage::TEXT)::NUMERIC, 50) / 100),
      2
    ) AS clinic_share
  FROM public.patient_operations po2
  JOIN public.doctors d ON d.id = po2.doctor_id
  WHERE COALESCE(po2.review_fee_amount, 0) > 0
    AND COALESCE(po2.is_review_statement, FALSE)
    AND COALESCE(po2.paid_amount, 0) > COALESCE(po2.review_fee_amount, 0)
    AND COALESCE(po2.paid_amount, 0) / COALESCE(po2.review_fee_amount, 1) <= 10.5
    AND COALESCE(NULLIF(d.payment_type, ''), 'percentage') <> 'salary'
    AND (
      COALESCE(po2.doctor_share_amount, 0) <= 0.01
      OR ABS(
        COALESCE(po2.doctor_share_amount, 0)
        - ROUND(
          GREATEST(
            0,
            COALESCE(po2.paid_amount, 0) - COALESCE(po2.review_fee_amount, 0)
          ) * (COALESCE((d.percentage::TEXT)::NUMERIC, 50) / 100),
          2
        )
      ) <= 0.02
    )
) sub
WHERE po.id = sub.id;

NOTIFY pgrst, 'reload schema';
