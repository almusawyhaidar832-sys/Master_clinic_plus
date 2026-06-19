-- تتبع المبالغ المُؤكَّد صرفها (جزئياً) — أجر يومي

ALTER TABLE public.salary_slips
  ADD COLUMN IF NOT EXISTS paid_net_payout DECIMAL(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.payroll_records
  ADD COLUMN IF NOT EXISTS paid_total_salary DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_doctor_share_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_clinic_share_amount DECIMAL(12, 2) NOT NULL DEFAULT 0;

-- مزامنة القسائم المدفوعة سابقاً
UPDATE public.salary_slips
SET paid_net_payout = net_payout
WHERE status = 'paid' AND paid_net_payout = 0;

UPDATE public.payroll_records
SET
  paid_total_salary = total_salary,
  paid_doctor_share_amount = doctor_share_amount,
  paid_clinic_share_amount = clinic_share_amount
WHERE status = 'paid' AND paid_total_salary = 0;

NOTIFY pgrst, 'reload schema';
