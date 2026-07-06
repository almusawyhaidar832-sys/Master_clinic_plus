-- إصلاح مضاعفة الكشفية: paid=35,000 (30+5 زيادة) → 30,000 (25,000 علاج + 5,000 كشفية)

UPDATE public.patient_operations po
SET
  paid_amount = sub.new_paid,
  doctor_share_amount = sub.doc_share,
  clinic_share_amount = sub.clinic_share
FROM (
  SELECT
    po2.id,
    ROUND(COALESCE(po2.paid_amount, 0) - COALESCE(po2.review_fee_amount, 0), 2) AS new_paid,
    ROUND(
      GREATEST(
        0,
        COALESCE(po2.paid_amount, 0)
        - COALESCE(po2.review_fee_amount, 0) * 2
        - COALESCE(po2.materials_cost, 0)
          * (COALESCE((d.materials_share::TEXT)::NUMERIC, 0) / 100)
      ) * (COALESCE((d.percentage::TEXT)::NUMERIC, 50) / 100),
      2
    ) AS doc_share,
    ROUND(
      COALESCE(po2.paid_amount, 0)
      - COALESCE(po2.review_fee_amount, 0)
      - GREATEST(
        0,
        COALESCE(po2.paid_amount, 0)
        - COALESCE(po2.review_fee_amount, 0) * 2
        - COALESCE(po2.materials_cost, 0)
          * (COALESCE((d.materials_share::TEXT)::NUMERIC, 0) / 100)
      ) * (COALESCE((d.percentage::TEXT)::NUMERIC, 50) / 100),
      2
    ) AS clinic_share
  FROM public.patient_operations po2
  JOIN public.doctors d ON d.id = po2.doctor_id
  WHERE COALESCE(po2.review_fee_amount, 0) > 0
    AND COALESCE(po2.is_review_statement, FALSE)
    AND COALESCE(po2.paid_amount, 0) > COALESCE(po2.review_fee_amount, 0) * 2
    AND COALESCE(po2.paid_amount, 0) / COALESCE(po2.review_fee_amount, 1) > 5
    AND COALESCE(po2.paid_amount, 0) / COALESCE(po2.review_fee_amount, 1) < 8
    AND COALESCE(NULLIF(d.payment_type, ''), 'percentage') <> 'salary'
    AND ABS(
      COALESCE(po2.doctor_share_amount, 0)
      - ROUND(
        GREATEST(
          0,
          COALESCE(po2.paid_amount, 0)
          - COALESCE(po2.review_fee_amount, 0) * 2
        ) * (COALESCE((d.percentage::TEXT)::NUMERIC, 50) / 100),
        2
      )
    ) <= 0.02
) sub
WHERE po.id = sub.id;

-- جلسات علاج فقط بدون رفع مضاعف: paid=25,000 + كشفية 5,000 → paid=30,000
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
    AND ABS(
      COALESCE(po2.doctor_share_amount, 0)
      - ROUND(
        COALESCE(po2.paid_amount, 0)
        * (COALESCE((d.percentage::TEXT)::NUMERIC, 50) / 100),
        2
      )
    ) > 0.02
    AND ABS(
      COALESCE(po2.doctor_share_amount, 0)
      - ROUND(
        GREATEST(
          0,
          COALESCE(po2.paid_amount, 0) - COALESCE(po2.review_fee_amount, 0)
        ) * (COALESCE((d.percentage::TEXT)::NUMERIC, 50) / 100),
        2
      )
    ) <= 0.02
) sub
WHERE po.id = sub.id;

NOTIFY pgrst, 'reload schema';
