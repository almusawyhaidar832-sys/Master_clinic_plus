-- نفّذ في Supabase → SQL Editor (مرة واحدة)
-- Doctor payment: percentage vs fixed salary

ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'percentage'
    CHECK (payment_type IN ('percentage', 'salary')),
  ADD COLUMN IF NOT EXISTS salary_amount DECIMAL(12, 2) NOT NULL DEFAULT 0
    CHECK (salary_amount >= 0);

COMMENT ON COLUMN public.doctors.payment_type IS
  'percentage = نسبة من الجلسات، salary = راتب ثابت شهري';
COMMENT ON COLUMN public.doctors.salary_amount IS
  'قيمة الراتب الثابت الشهري — يُستخدم عند payment_type = salary';
