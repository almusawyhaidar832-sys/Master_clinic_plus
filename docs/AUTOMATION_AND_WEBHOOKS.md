# الأتمتة، Webhooks، والأداء — Master Clinic Plus

## ما يُنفَّذ تلقائياً اليوم (من التطبيق)

| الحدث | للمراجع (واتساب) | للطبيب |
|--------|------------------|--------|
| حفظ جلسة / دفعة (محاسب) | رسالة: عيادة، رقم جلسة، مدفوع، متبقي، حالة، إجراء، أسنان | إشعار داخل التطبيق + واتساب إن وُجد رقم للطبيب |
| إكمال الخطة العلاجية | نفس الرسالة + «تم إكمال الخطة العلاجية بنجاح» | إشعار |
| رفع أشعة | رابط صورة (24 ساعة) عبر Supabase Signed URL | — |
| تعديل جلسة (PATCH) | إعادة إرسال تحديث (اختياري) | إشعار |

**نقاط الدخول في الكود:**

- `POST /api/automation/dispatch` — من الواجهة بعد حفظ الجلسة
- `src/lib/automation/run.ts` — منطق الإرسال
- `src/app/api/clinical/xray-upload/route.ts` — بعد الرفع
- `PATCH /api/operations/[id]` — تعديل + `audit_logs`

---

## 1) تشغيل قاعدة البيانات

في Supabase SQL Editor نفّذ:

`supabase/migrations/20260608000000_automation_audit.sql`

يُنشئ:

- `audit_logs` — من عدّل ماذا ومتى
- `automation_outbox` — طابور اختياري للمعالجة لاحقاً
- قيم جديدة لـ `whatsapp_message_type`

تأكد أن جدول `doctors` يحتوي `phone` للطبيب إن أردت تنبيهات واتساب للطبيب.

---

## 2) Evolution API — Webhooks (بدون تأخير)

### لماذا Webhook؟

الإرسال الحالي: **التطبيق → Evolution** مباشرة بعد حفظ الجلسة (جيد لمعظم العيادات).

للحمل العالي أو إعادة المحاولة عند انقطاع Evolution:

```
Supabase (INSERT patient_operations)
    → Database Webhook / Edge Function
        → automation_outbox (pending)
            → Worker (Vercel Cron كل دقيقة)
                → Evolution sendText
```

### إعداد Webhook في Evolution (استقبال — رسائل واردة)

1. في Evolution Manager: **Webhook** → `WEBHOOK_GLOBAL_URL`
2. مثال: `https://YOUR-APP.vercel.app/api/webhooks/evolution`
3. فعّل الأحداث: `MESSAGES_UPSERT`, `CONNECTION_UPDATE`
4. استخدم `WEBHOOK_GLOBAL_HEADERS` مع سر:

```env
EVOLUTION_WEBHOOK_SECRET=your-random-secret
```

4. أنشئ مسار `api/webhooks/evolution` يتحقق من التوقيع ويحدّث `whatsapp_linked` عند `CONNECTION_UPDATE`.

> **ملاحظة:** مسار الاستقبال غير مُضمَّن بعد — الأتمتة الصادرة تعمل من التطبيق مباشرة.

### إعداد Webhook من Supabase (صادر — أتمتة فورية)

**الخيار أ — Database Webhook (موصى به للسرعة):**

1. Supabase → Database → Webhooks → Create
2. Table: `patient_operations`, Events: `INSERT`, `UPDATE`
3. URL: `https://YOUR-APP.vercel.app/api/automation/dispatch`
4. Header: `Authorization: Bearer <INTERNAL_AUTOMATION_SECRET>`
5. Body مخصص: `{ "event": "session_saved", "operationId": "{{ record.id }}" }`

أضف في Vercel:

```env
INTERNAL_AUTOMATION_SECRET=long-random-secret
```

وعدّل `dispatch/route.ts` لقبول هذا السر بدون جلسة مستخدم (للـ webhook فقط).

**الخيار ب — PostgreSQL Trigger + `pg_net`:**

```sql
-- بعد تفعيل pg_net في Supabase
CREATE OR REPLACE FUNCTION notify_session_automation()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://YOUR-APP.vercel.app/api/automation/dispatch',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer SECRET"}'::jsonb,
    body := json_build_object(
      'event', 'session_saved',
      'operationId', NEW.id::text
    )::jsonb
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_session_automation
  AFTER INSERT OR UPDATE ON public.patient_operations
  FOR EACH ROW
  EXECUTE FUNCTION notify_session_automation();
```

**تحذير:** قد يُرسل مرتين إذا استدعيت من التطبيق **و** من Trigger — اختر مساراً واحداً أو أضف `idempotency_key` في `automation_outbox`.

---

## 3) الأداء والتأخير

| الطبقة | توصية |
|--------|--------|
| إرسال واتساب | غير متزامن — `void runSessionSavedAutomation()` بعد الاستجابة للمستخدم |
| Evolution على Render | استخدم خطة لا تنام؛ Railway + Volume للجلسة |
| Supabase | فهارس موجودة على `patient_operations(patient_id)`, `audit_logs(clinic_id)` |
| PDF | يُنشأ في المتصفح (jspdf) — لا حمل على الخادم |
| صور الأشعة | Signed URL 24 ساعة — لا تُرفع الملف عبر واتساب API (أخف من sendMedia) |

### طابور `automation_outbox` (مرحلة لاحقة)

```sql
INSERT INTO automation_outbox (clinic_id, event_type, payload)
VALUES (..., 'session_saved', '{"operationId":"..."}');
```

Cron على Vercel:

```json
{ "crons": [{ "path": "/api/cron/process-automation", "schedule": "* * * * *" }] }
```

يعالج الصفوف `pending` بـ `attempts < 3` ويستدعي `runSessionSavedAutomation`.

---

## 4) التقارير PDF

- **طبيب:** `/doctor/statement` → «تصدير PDF»
- **محاسب:** `/dashboard/reports` → بعد إنشاء التقرير → «تصدير PDF»
- **كشف مراجع:** من ملف المريض في المحاسب (طباعة + PDF عبر نفس المكوّن عند إضافة زر لاحقاً)

الكود: `src/lib/reports/pdf-export.ts`

---

## 5) سجل التعديل (Audit)

```sql
SELECT * FROM audit_logs
WHERE clinic_id = '...'
ORDER BY changed_at DESC
LIMIT 50;
```

واجهة عرض السجل يمكن إضافتها لاحقاً في `/dashboard/settings`.

---

## 6) متغيرات البيئة

```env
WHATSAPP_API_URL=
WHATSAPP_API_KEY=
WHATSAPP_INSTANCE_NAME=
WHATSAPP_PROVIDER=evolution
# اختياري لـ webhooks داخلية:
INTERNAL_AUTOMATION_SECRET=
EVOLUTION_WEBHOOK_SECRET=
```

---

## 7) اختبار سريع

1. ربط واتساب من `/dashboard/whatsapp`
2. تسجيل دفعة من «إدخال سريع» لمراجع له هاتف
3. تحقق من `whatsapp_messages` في Supabase
4. افتح `/doctor/notifications` كطبيب
5. ارفع أشعة — تحقق من رسالة الرابط
6. عدّل جلسة من ملف المريض → `audit_logs`
