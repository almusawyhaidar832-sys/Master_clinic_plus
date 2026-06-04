-- تعطيل/تفعيل العيادات من لوحة المدير العام
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
