-- إصلاح ربط المراجعين/الحالات بالطبيب الصحيح (بيانات قديمة)
-- شغّله مرة واحدة في Supabase SQL Editor بعد التحديث

-- 1) حدّث primary_doctor_id للحالات من أول عملية مسجّلة لكل حالة
UPDATE patient_treatment_cases c
SET primary_doctor_id = sub.doctor_id
FROM (
  SELECT DISTINCT ON (po.treatment_case_id)
    po.treatment_case_id,
    po.doctor_id
  FROM patient_operations po
  WHERE po.treatment_case_id IS NOT NULL
    AND po.doctor_id IS NOT NULL
  ORDER BY po.treatment_case_id, po.operation_date ASC, po.created_at ASC
) sub
WHERE c.id = sub.treatment_case_id
  AND (c.primary_doctor_id IS NULL OR c.primary_doctor_id <> sub.doctor_id);

-- 2) حدّث primary_doctor_id للمرضى من آخر حالة لهم
UPDATE patients p
SET primary_doctor_id = sub.primary_doctor_id
FROM (
  SELECT DISTINCT ON (patient_id)
    patient_id,
    primary_doctor_id
  FROM patient_treatment_cases
  WHERE primary_doctor_id IS NOT NULL
  ORDER BY patient_id, updated_at DESC NULLS LAST, created_at DESC
) sub
WHERE p.id = sub.patient_id
  AND (p.primary_doctor_id IS NULL OR p.primary_doctor_id <> sub.primary_doctor_id);

-- 3) مرضى بدون حالات: من آخر عملية
UPDATE patients p
SET primary_doctor_id = sub.doctor_id
FROM (
  SELECT DISTINCT ON (patient_id)
    patient_id,
    doctor_id
  FROM patient_operations
  WHERE doctor_id IS NOT NULL
  ORDER BY patient_id, operation_date DESC, created_at DESC
) sub
WHERE p.id = sub.patient_id
  AND p.primary_doctor_id IS NULL;
