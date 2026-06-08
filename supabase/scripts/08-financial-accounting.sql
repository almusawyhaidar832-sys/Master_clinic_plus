-- محاسبة: معاملات مالية + رواتب مُولَّدة في صافي الربح

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS reference_type TEXT;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS reference_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_reference_unique
  ON public.transactions(clinic_id, reference_type, reference_id)
  WHERE reference_id IS NOT NULL;

COMMENT ON COLUMN public.transactions.reference_type IS
  'expense | staff_salary_accrual | staff_salary_paid | assistant_payroll_doctor | assistant_payroll_clinic';
