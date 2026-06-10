-- ربط فواتير الصرف (doctor_expenses) بالسجل التاريخي

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

NOTIFY pgrst, 'reload schema';
