-- ربط N8N Bot (واتساب + AI) لكل عيادة — إضافي بالكامل، لا يغيّر أي سلوك حالي.
-- الافتراضي لكل عيادة: provider = 'evolution' (السلوك الحالي بدون أي تغيير).

CREATE TABLE IF NOT EXISTS public.clinic_integrations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL DEFAULT 'evolution'
                         CHECK (provider IN ('evolution', 'n8n_bot', 'disabled')),
  bot_api_key_hash    TEXT,           -- sha256(hex) للمفتاح — لا يُخزَّن المفتاح نفسه
  bot_api_key_prefix  TEXT,           -- أول أحرف المفتاح فقط، للعرض في الواجهة
  webhook_url         TEXT,           -- عنوان n8n لاستقبال أحداث Master Clinic
  webhook_secret      TEXT,           -- سر توقيع HMAC-SHA256 للـ webhook
  whatsapp_numbers    TEXT[] NOT NULL DEFAULT '{}', -- رقم واحد أو أكثر لهذه العيادة
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clinic_id)
);

CREATE INDEX IF NOT EXISTS idx_clinic_integrations_whatsapp_numbers
  ON public.clinic_integrations USING GIN (whatsapp_numbers);

COMMENT ON TABLE public.clinic_integrations IS
  'إعدادات ربط كل عيادة بمزوّد واتساب خارجي (N8N Bot) — provider=evolution يعني السلوك الحالي بدون تغيير';
COMMENT ON COLUMN public.clinic_integrations.provider IS
  'evolution = Master Clinic يرسل عبر Evolution (الافتراضي) | n8n_bot = يُرسل عبر webhook لنظام N8N | disabled = لا إرسال';

-- تحديث updated_at تلقائياً
CREATE OR REPLACE FUNCTION public.touch_clinic_integrations_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_clinic_integrations ON public.clinic_integrations;
CREATE TRIGGER trg_touch_clinic_integrations
  BEFORE UPDATE ON public.clinic_integrations
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_clinic_integrations_updated_at();

ALTER TABLE public.clinic_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clinic_integrations_tenant ON public.clinic_integrations;

-- نفس نمط RLS المستخدم في audit_logs — tenant_can_access إن وُجدت، وإلا get_my_clinic_id
-- ملاحظة أمنية: الوصول الفعلي لهذا الجدول اليوم هو من الخادم فقط (service role عبر
-- getAdminClient) — هذه السياسة احتياطية لأي استخدام مستقبلي من واجهة العميل، ويجب
-- عند بناء صفحة الإعدادات إخفاء bot_api_key_hash و webhook_secret عن المتصفح دائماً.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'tenant_can_access'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY clinic_integrations_tenant ON public.clinic_integrations
        FOR ALL TO authenticated
        USING (public.tenant_can_access(clinic_id))
        WITH CHECK (public.tenant_can_access(clinic_id))
    $pol$;
  ELSE
    EXECUTE $pol$
      CREATE POLICY clinic_integrations_tenant ON public.clinic_integrations
        FOR ALL TO authenticated
        USING (clinic_id = public.get_my_clinic_id())
        WITH CHECK (clinic_id = public.get_my_clinic_id())
    $pol$;
  END IF;
END $$;

-- مصدر الحجز — إضافي بقيمة افتراضية، لا يؤثر على أي صف أو استعلام حالي
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'staff';

COMMENT ON COLUMN public.appointments.source IS
  'staff = حجز موظف (الافتراضي) | online = بوابة الحجز العامة | whatsapp_bot = حجز عبر بوت واتساب خارجي (N8N)';
