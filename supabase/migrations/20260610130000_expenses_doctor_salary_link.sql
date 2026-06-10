-- ربط مصروفات راتب الأطباء بسجل الطبيب
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS doctor_id UUID REFERENCES public.doctors(id) ON DELETE SET NULL;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS expense_kind TEXT NOT NULL DEFAULT 'general';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'expenses_expense_kind_check'
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_expense_kind_check
      CHECK (expense_kind IN ('general', 'doctor_salary'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_expenses_doctor_salary
  ON public.expenses(clinic_id, doctor_id, expense_kind, expense_date)
  WHERE expense_kind = 'doctor_salary';

COMMENT ON COLUMN public.expenses.doctor_id IS 'الطبيب المرتبط — لمصروفات راتب الطبيب';
COMMENT ON COLUMN public.expenses.expense_kind IS 'general | doctor_salary';

-- ربط المصروفات السابقة من حركات doctor_salary_paid
UPDATE public.expenses e
SET
  doctor_id = t.doctor_id,
  expense_kind = 'doctor_salary'
FROM public.transactions t
WHERE t.reference_type = 'doctor_salary_payout'
  AND t.reference_id = e.id
  AND t.type = 'doctor_salary_paid'
  AND t.doctor_id IS NOT NULL
  AND (e.doctor_id IS NULL OR e.expense_kind = 'general');

NOTIFY pgrst, 'reload schema';
