-- أتمتة + سجل تدقيق + أنواع رسائل واتساب إضافية
-- يستخدم get_my_clinic_id() (موجود في initial_schema) — وليس current_clinic_id()

DO $$ BEGIN
  ALTER TYPE public.whatsapp_message_type ADD VALUE 'session_update';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE public.whatsapp_message_type ADD VALUE 'treatment_completed';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE public.whatsapp_message_type ADD VALUE 'xray_link';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE public.whatsapp_message_type ADD VALUE 'doctor_payment_alert';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- دالة العيادة الحالية (إن لم تكن موجودة بعد bootstrap فقط)
CREATE OR REPLACE FUNCTION public.get_my_clinic_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT clinic_id FROM public.profiles WHERE id = auth.uid();
$$;

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

CREATE INDEX IF NOT EXISTS idx_audit_logs_clinic_entity
  ON public.audit_logs(clinic_id, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_changed_at
  ON public.audit_logs(clinic_id, changed_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_logs_tenant ON public.audit_logs;

-- tenant_can_access إن وُجدت (بعد fix-apply-tenant-rls)، وإلا get_my_clinic_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'tenant_can_access'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY audit_logs_tenant ON public.audit_logs
        FOR ALL TO authenticated
        USING (public.tenant_can_access(clinic_id))
        WITH CHECK (public.tenant_can_access(clinic_id))
    $pol$;
  ELSE
    EXECUTE $pol$
      CREATE POLICY audit_logs_tenant ON public.audit_logs
        FOR ALL TO authenticated
        USING (clinic_id = public.get_my_clinic_id())
        WITH CHECK (clinic_id = public.get_my_clinic_id())
    $pol$;
  END IF;
END $$;

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

CREATE INDEX IF NOT EXISTS idx_automation_outbox_pending
  ON public.automation_outbox(status, created_at)
  WHERE status = 'pending';

-- الطابور يُدار من الخادم فقط (service_role) — بدون سياسات للمستخدمين
ALTER TABLE public.automation_outbox ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.audit_logs IS 'سجل تعديلات الجلسات والمدفوعات — من قام ومتى';
COMMENT ON TABLE public.automation_outbox IS 'طابور أحداث للمعالجة غير المتزامنة (واتساب/إشعارات)';
