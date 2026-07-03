-- تصحيح جلسات الدفع القديمة: خصم المختبر لم يكن يُطبَّق على جلسات المتابعة
-- شغّل بعد: 30-payment-session-lab-deduction.sql

ALTER TABLE public.patient_operations DISABLE TRIGGER USER;

UPDATE public.patient_operations po
SET
  doctor_share_amount = sub.new_doc,
  clinic_share_amount = sub.new_clinic
FROM (
  SELECT
    po2.id,
    ROUND(
      COALESCE(po2.paid_amount, 0)
        * COALESCE(ptc.doctor_share_total, p.doctor_share_total, 0)
        / NULLIF(COALESCE(ptc.final_price, p.agreed_total, 0), 0)
        - COALESCE(po2.materials_cost, 0)
          * GREATEST(0, LEAST(100, (d.materials_share::TEXT)::NUMERIC)) / 100,
      2
    ) AS new_doc,
    ROUND(
      COALESCE(po2.paid_amount, 0)
        * COALESCE(ptc.clinic_share_total, p.clinic_share_total, 0)
        / NULLIF(COALESCE(ptc.final_price, p.agreed_total, 0), 0)
        - COALESCE(po2.materials_cost, 0)
          * (100 - GREATEST(0, LEAST(100, (d.materials_share::TEXT)::NUMERIC))) / 100,
      2
    ) AS new_clinic,
    ROUND(
      COALESCE(po2.paid_amount, 0)
        * COALESCE(ptc.doctor_share_total, p.doctor_share_total, 0)
        / NULLIF(COALESCE(ptc.final_price, p.agreed_total, 0), 0),
      2
    ) AS base_doc_without_lab
  FROM public.patient_operations po2
  JOIN public.doctors d ON d.id = po2.doctor_id
  LEFT JOIN public.patient_treatment_cases ptc ON ptc.id = po2.treatment_case_id
  LEFT JOIN public.patients p ON p.id = po2.patient_id
  WHERE po2.session_kind = 'payment'
    AND COALESCE(po2.materials_cost, 0) > 0
    AND COALESCE(po2.paid_amount, 0) > 0
    AND COALESCE(NULLIF(d.payment_type, ''), 'percentage') <> 'salary'
    AND COALESCE(ptc.final_price, p.agreed_total, 0) > 0
) sub
WHERE po.id = sub.id
  AND ABS(COALESCE(po.doctor_share_amount, 0) - sub.base_doc_without_lab) < 0.02
  AND ABS(COALESCE(po.doctor_share_amount, 0) - sub.new_doc) >= 0.01;

ALTER TABLE public.patient_operations ENABLE TRIGGER USER;

NOTIFY pgrst, 'reload schema';
