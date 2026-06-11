-- توسيع نسب الطبيب وتحمل المختبر حتى 100%

ALTER TYPE public.doctor_percentage ADD VALUE IF NOT EXISTS '90';
ALTER TYPE public.doctor_percentage ADD VALUE IF NOT EXISTS '100';

ALTER TYPE public.materials_cost_share ADD VALUE IF NOT EXISTS '60';
ALTER TYPE public.materials_cost_share ADD VALUE IF NOT EXISTS '70';
ALTER TYPE public.materials_cost_share ADD VALUE IF NOT EXISTS '80';
ALTER TYPE public.materials_cost_share ADD VALUE IF NOT EXISTS '90';
ALTER TYPE public.materials_cost_share ADD VALUE IF NOT EXISTS '100';

NOTIFY pgrst, 'reload schema';
