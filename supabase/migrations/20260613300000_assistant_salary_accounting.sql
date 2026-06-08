-- Assistant salary accounting: total_salary + doctor_share_percentage
-- Run via: supabase db push  OR  paste in Supabase SQL Editor

ALTER TABLE public.assistants
  ADD COLUMN IF NOT EXISTS total_salary DECIMAL(12, 2) NOT NULL DEFAULT 0
    CHECK (total_salary >= 0),
  ADD COLUMN IF NOT EXISTS doctor_share_percentage NUMERIC(5, 2) NOT NULL DEFAULT 0
    CHECK (doctor_share_percentage >= 0 AND doctor_share_percentage <= 100);

COMMENT ON COLUMN public.assistants.total_salary IS
  'الراتب الكلي الشهري للمساعد';
COMMENT ON COLUMN public.assistants.doctor_share_percentage IS
  'نسبة تحمّل الطبيب من راتب المساعد (0–100) — الباقي للعيادة';
