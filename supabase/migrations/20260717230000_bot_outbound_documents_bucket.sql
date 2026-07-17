-- Bucket تخزين مؤقت لمستندات (فواتير/وصفات) تُرسَل عبر N8N Bot كرابط موقّع
-- بدل ملف Base64 كامل داخل الـ webhook. إضافي بالكامل — لا يغيّر أي bucket حالي.
-- الوصول محصور بـ service role فقط (نفس نمط باقي الـ buckets الخاصة بالنظام).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'bot-outbound-documents',
  'bot-outbound-documents',
  FALSE,
  10485760,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

COMMENT ON COLUMN public.clinic_integrations.webhook_url IS
  'عنوان n8n لاستقبال أحداث Master Clinic — يشمل الآن أيضاً message.text و message.document (روابط PDF موقّعة لمدة 24 ساعة عبر bot-outbound-documents)';
