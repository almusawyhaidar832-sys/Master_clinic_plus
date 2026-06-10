-- تشغيل يدوي في Supabase SQL Editor — ربط مصروف راتب الطبيب بـ doctor_id
-- يتطلب migration 20260610130000_expenses_doctor_salary_link.sql

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
