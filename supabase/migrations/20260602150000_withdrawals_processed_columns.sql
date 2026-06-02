-- Ensure doctor_withdrawals has processed_by / processed_at (required for approve/reject/cash)

ALTER TABLE public.doctor_withdrawals
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

ALTER TABLE public.doctor_withdrawals
  ADD COLUMN IF NOT EXISTS processed_by UUID REFERENCES public.profiles(id);

COMMENT ON COLUMN public.doctor_withdrawals.processed_by IS
  'Profile id of accountant/owner who approved, rejected, or recorded payment';

COMMENT ON COLUMN public.doctor_withdrawals.processed_at IS
  'When the withdrawal was approved, rejected, or paid';

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
