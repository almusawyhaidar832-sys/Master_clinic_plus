-- Multiple treatment cases per patient (حشوة ضوئية، تقويم، ...)

CREATE TABLE IF NOT EXISTS public.patient_treatment_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  treatment_name_ar TEXT NOT NULL,
  case_price DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (case_price >= 0),
  discount_total DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  final_price DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (final_price >= 0),
  doctor_share_total DECIMAL(12, 2) NOT NULL DEFAULT 0,
  clinic_share_total DECIMAL(12, 2) NOT NULL DEFAULT 0,
  total_paid DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (total_paid >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_treatment_cases_patient
  ON public.patient_treatment_cases(patient_id);

CREATE INDEX IF NOT EXISTS idx_patient_treatment_cases_status
  ON public.patient_treatment_cases(patient_id, status);

ALTER TABLE public.patient_operations
  ADD COLUMN IF NOT EXISTS treatment_case_id UUID
    REFERENCES public.patient_treatment_cases(id) ON DELETE SET NULL;

-- Migrate legacy single plan → one case per patient (operation_name_ar only)
INSERT INTO public.patient_treatment_cases (
  patient_id,
  clinic_id,
  treatment_name_ar,
  case_price,
  discount_total,
  final_price,
  doctor_share_total,
  clinic_share_total,
  total_paid,
  status,
  created_at,
  updated_at
)
SELECT
  ptp.patient_id,
  ptp.clinic_id,
  COALESCE(
    (
      SELECT COALESCE(NULLIF(TRIM(po.operation_name_ar), ''), 'علاج')
      FROM public.patient_operations po
      WHERE po.patient_id = ptp.patient_id
        AND COALESCE(po.total_amount, 0) > 0
      ORDER BY po.created_at ASC
      LIMIT 1
    ),
    'علاج أساسي'
  ),
  ptp.case_price,
  ptp.discount_total,
  ptp.final_price,
  ptp.doctor_share_total,
  ptp.clinic_share_total,
  ptp.total_paid,
  ptp.status,
  NOW(),
  NOW()
FROM public.patient_treatment_plans ptp
WHERE NOT EXISTS (
  SELECT 1 FROM public.patient_treatment_cases c
  WHERE c.patient_id = ptp.patient_id
);

-- Patients with sessions but no row in patient_treatment_plans
INSERT INTO public.patient_treatment_cases (
  patient_id,
  clinic_id,
  treatment_name_ar,
  case_price,
  discount_total,
  final_price,
  doctor_share_total,
  clinic_share_total,
  total_paid,
  status,
  created_at,
  updated_at
)
SELECT
  p.id,
  p.clinic_id,
  COALESCE(NULLIF(TRIM(po.operation_name_ar), ''), 'علاج'),
  GREATEST(COALESCE(s.max_total, 0), COALESCE(s.sum_paid, 0) + COALESCE(s.max_remaining, 0)),
  0,
  GREATEST(COALESCE(s.max_total, 0), COALESCE(s.sum_paid, 0) + COALESCE(s.max_remaining, 0)),
  0,
  0,
  COALESCE(s.sum_paid, 0),
  CASE WHEN COALESCE(s.max_remaining, 0) <= 0 AND COALESCE(s.sum_paid, 0) > 0 THEN 'completed' ELSE 'active' END,
  NOW(),
  NOW()
FROM public.patients p
JOIN LATERAL (
  SELECT operation_name_ar
  FROM public.patient_operations
  WHERE patient_id = p.id
  ORDER BY created_at ASC
  LIMIT 1
) po ON TRUE
JOIN LATERAL (
  SELECT
    MAX(COALESCE(total_amount, 0)) AS max_total,
    SUM(COALESCE(paid_amount, 0)) AS sum_paid,
    MAX(GREATEST(0, COALESCE(remaining_debt, COALESCE(total_amount, 0) - COALESCE(paid_amount, 0)))) AS max_remaining
  FROM public.patient_operations
  WHERE patient_id = p.id
) s ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.patient_treatment_cases c WHERE c.patient_id = p.id
);

NOTIFY pgrst, 'reload schema';
