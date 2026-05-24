-- Paste into Supabase → SQL Editor → Run
-- Use this if register/login says "لا توجد عيادة مسجّلة"

-- Table already created by: supabase/migrations/20260523000000_initial_schema.sql
-- Do NOT run a minimal CREATE TABLE clinics — it will conflict with the full schema.

INSERT INTO public.clinics (name, name_ar, phone)
SELECT 'Master Clinic Plus', 'ماستر كلينك بلس', NULL
WHERE NOT EXISTS (SELECT 1 FROM public.clinics LIMIT 1);

-- Verify
SELECT id, name, created_at FROM public.clinics;
