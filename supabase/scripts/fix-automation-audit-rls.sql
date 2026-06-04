-- إصلاح سياسة audit_logs بعد خطأ current_clinic_id() does not exist
-- الصق هذا الملف كاملاً في Supabase SQL Editor ثم Run

CREATE OR REPLACE FUNCTION public.get_my_clinic_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT clinic_id FROM public.profiles WHERE id = auth.uid();
$$;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_logs_tenant ON public.audit_logs;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'tenant_can_access'
  ) THEN
    CREATE POLICY audit_logs_tenant ON public.audit_logs
      FOR ALL TO authenticated
      USING (public.tenant_can_access(clinic_id))
      WITH CHECK (public.tenant_can_access(clinic_id));
  ELSE
    CREATE POLICY audit_logs_tenant ON public.audit_logs
      FOR ALL TO authenticated
      USING (clinic_id = public.get_my_clinic_id())
      WITH CHECK (clinic_id = public.get_my_clinic_id());
  END IF;
END $$;

-- تأكيد أن الجداول موجودة (إن فشل الملف السابق عند السياسة فقط)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  changed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  before_data JSONB,
  after_data JSONB,
  note TEXT
);

CREATE TABLE IF NOT EXISTS public.automation_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

ALTER TABLE public.automation_outbox ENABLE ROW LEVEL SECURITY;

SELECT 'audit_logs RLS fixed' AS status;
