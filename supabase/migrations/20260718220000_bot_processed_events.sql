-- سجلّ عام لعزل الأحداث المكرّرة (idempotency) القادمة من أنظمة خارجية عبر
-- Bot API (مثل N8N) — إضافي بالكامل، لا يغيّر أي جدول أو سلوك حالي، وغير
-- مرتبط بالمواعيد تحديداً (أي نوع حدث خارجي يمكن أن يستخدمه).

CREATE TABLE IF NOT EXISTS public.bot_processed_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  idempotency_key  TEXT NOT NULL,
  processed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    10|  UNIQUE (clinic_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_bot_processed_events_clinic
  ON public.bot_processed_events (clinic_id);

COMMENT ON TABLE public.bot_processed_events IS
  'سجلّ عزل تكرار عام (idempotency) لأحداث خارجية تصل عبر Bot API — غير مرتبط بنوع حدث معيّن';
COMMENT ON COLUMN public.bot_processed_events.idempotency_key IS
    20|  'مفتاح فريد لكل عيادة يحدده المستدعي الخارجي (مثل N8N) — تكراره لنفس العيادة يعني نفس الحدث';

ALTER TABLE public.bot_processed_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bot_processed_events_tenant ON public.bot_processed_events;

-- نفس نمط RLS المستخدم في clinic_integrations — الوصول الفعلي اليوم من الخادم
-- فقط (service role عبر getAdminClient)، هذه سياسة احتياطية لأي استخدام مستقبلي.
DO $$
BEGIN
  IF EXISTS (
   30|    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'tenant_can_access'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY bot_processed_events_tenant ON public.bot_processed_events
        FOR ALL TO authenticated
        USING (public.tenant_can_access(clinic_id))
        WITH CHECK (public.tenant_can_access(clinic_id))
    40|    $pol$;
  ELSE
    EXECUTE $pol$
      CREATE POLICY bot_processed_events_tenant ON public.bot_processed_events
        FOR ALL TO authenticated
        USING (clinic_id = public.get_my_clinic_id())
        WITH CHECK (clinic_id = public.get_my_clinic_id())
    $pol$;
  END IF;
END $$;
