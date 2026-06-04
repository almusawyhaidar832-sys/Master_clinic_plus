-- تعطيل/تفعيل العيادة من لوحة المدير العام
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_clinics_is_active ON public.clinics (is_active);

COMMENT ON COLUMN public.clinics.is_active IS
  'false = العيادة موقوفة مؤقتاً عن النظام';
