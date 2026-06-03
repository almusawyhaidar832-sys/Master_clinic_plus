-- السجل الطبي (مخطط الأسنان + أشعة) — شغّل في Supabase → SQL Editor
-- يصلح: Could not find the table 'public.operation_tooth_records' in the schema cache

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.operation_xray_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  operation_id UUID NOT NULL REFERENCES public.patient_operations(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name TEXT,
  mime_type TEXT,
  uploaded_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operation_xray_operation
  ON public.operation_xray_images(operation_id);

CREATE TABLE IF NOT EXISTS public.operation_tooth_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  operation_id UUID NOT NULL REFERENCES public.patient_operations(id) ON DELETE CASCADE,
  tooth_number SMALLINT NOT NULL CHECK (tooth_number BETWEEN 11 AND 48),
  procedure_ar TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (operation_id, tooth_number)
);

CREATE INDEX IF NOT EXISTS idx_operation_tooth_operation
  ON public.operation_tooth_records(operation_id);

ALTER TABLE public.operation_xray_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_tooth_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operation_xray_tenant ON public.operation_xray_images;
CREATE POLICY operation_xray_tenant ON public.operation_xray_images
  FOR ALL
  USING (public.tenant_can_access(clinic_id))
  WITH CHECK (public.tenant_can_access(clinic_id));

DROP POLICY IF EXISTS operation_tooth_tenant ON public.operation_tooth_records;
CREATE POLICY operation_tooth_tenant ON public.operation_tooth_records
  FOR ALL
  USING (public.tenant_can_access(clinic_id))
  WITH CHECK (public.tenant_can_access(clinic_id));

-- bucket للأشعة (اختياري — إن فشل تجاهل وأنشئه من لوحة Storage)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'clinical-xrays',
  'clinical-xrays',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
