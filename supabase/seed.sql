-- Seed: default clinic (run in Supabase SQL Editor after migrations)
-- Safe to run multiple times — skips insert if a clinic already exists.

INSERT INTO public.clinics (name, name_ar, phone)
SELECT 'Master Clinic Plus', 'ماستر كلينك بلس', NULL
WHERE NOT EXISTS (SELECT 1 FROM public.clinics LIMIT 1);

-- Optional: after creating a user in Auth (or via /login register), link profile:
/*
INSERT INTO public.profiles (id, clinic_id, role, full_name, username)
VALUES (
  'USER_UUID_FROM_AUTH',
  (SELECT id FROM public.clinics ORDER BY created_at LIMIT 1),
  'accountant',
  'محاسب العيادة',
  'admin'
);

SELECT public.seed_default_operation_types(
  (SELECT id FROM public.clinics ORDER BY created_at LIMIT 1)
);
*/
