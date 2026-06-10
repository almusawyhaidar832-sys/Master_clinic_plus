-- تشغيل يدوي — ربط صرفيات الأطباء بالسجل التاريخي

ALTER TABLE public.invoices_history
  ADD COLUMN IF NOT EXISTS doctor_expense_id UUID REFERENCES public.doctor_expenses(id) ON DELETE SET NULL;

ALTER TABLE public.invoices_history
  ADD COLUMN IF NOT EXISTS record_kind TEXT NOT NULL DEFAULT 'session_invoice';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_history_record_kind_check'
  ) THEN
    ALTER TABLE public.invoices_history
      ADD CONSTRAINT invoices_history_record_kind_check
      CHECK (record_kind IN ('session_invoice', 'doctor_expense'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_history_doctor_expense
  ON public.invoices_history(doctor_expense_id)
  WHERE doctor_expense_id IS NOT NULL;

ALTER TABLE public.doctor_expenses
  ADD COLUMN IF NOT EXISTS archived_to_history BOOLEAN NOT NULL DEFAULT false;

-- أرشفة الصرفيات القديمة التي لم تُسجّل بعد
INSERT INTO public.invoices_history (
  clinic_id,
  doctor_id,
  doctor_expense_id,
  record_kind,
  invoice_number,
  patient_name_ar,
  doctor_name_ar,
  procedure_label,
  treatment_name,
  total_amount,
  paid_amount,
  remaining_amount,
  doctor_share,
  clinic_share,
  invoice_date,
  finalized_at,
  finalized_by,
  snapshot_json
)
SELECT
  de.clinic_id,
  de.doctor_id,
  de.id,
  'doctor_expense',
  'EXP-' || REPLACE(de.expense_date::TEXT, '-', '') || '-' || UPPER(SUBSTRING(REPLACE(de.id::TEXT, '-', ''), 1, 8)),
  '',
  COALESCE(d.full_name_ar, ''),
  COALESCE(NULLIF(TRIM(de.description_ar), ''), 'صرفية عيادة'),
  'صرفية',
  de.amount,
  de.amount,
  0,
  ROUND((de.amount * de.percentage_split / 100)::NUMERIC, 2),
  ROUND((de.amount - (de.amount * de.percentage_split / 100))::NUMERIC, 2),
  de.expense_date,
  COALESCE(de.created_at, NOW()),
  de.created_by,
  jsonb_build_object(
    'kind', 'doctor_expense',
    'doctor_expense_id', de.id,
    'amount', de.amount,
    'percentage_split', de.percentage_split,
    'description_ar', de.description_ar
  )
FROM public.doctor_expenses de
LEFT JOIN public.doctors d ON d.id = de.doctor_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.invoices_history ih
  WHERE ih.doctor_expense_id = de.id
);

UPDATE public.doctor_expenses de
SET archived_to_history = true
WHERE EXISTS (
  SELECT 1 FROM public.invoices_history ih
  WHERE ih.doctor_expense_id = de.id
);

NOTIFY pgrst, 'reload schema';
