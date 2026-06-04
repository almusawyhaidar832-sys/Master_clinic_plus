# ربط Master Clinic Plus بـ Evolution API (واتساب مجاني — Baileys)

## المعمارية

```
[متصفح] → /dashboard/whatsapp → GET /api/whatsapp/qr → [Evolution API على Render/Railway]
                                              ↓
                                    base64 QR → <img src="data:image/png;base64,...">
                                              ↓
                         مسح QR من جوال العيادة → polling /api/whatsapp/status
                                              ↓
                         whatsapp_linked = true في جدول clinics

[إرسال رسالة] → /api/whatsapp/send → POST /message/sendText/{instance}
```

**ملاحظة:** رمز QR **لا يُخزَّن في Supabase** — يأتي مباشرة من Evolution ويُعرض في الواجهة. عند الاتصال يُحفظ فقط `whatsapp_linked` و `whatsapp_session_id` (اسم الـ instance).

---

## 1) نشر Evolution API (Self-host)

### الخيار أ — Railway (الأسهل)

1. افتح [Evolution API Lite على Railway](https://railway.com/deploy/evolution-api-lite-version) أو قالب Evolution API الكامل.
2. أضف **PostgreSQL** و **Volume** (مهم لحفظ جلسة WhatsApp).
3. في Variables عيّن:

| المتغير | مثال |
|---------|------|
| `AUTHENTICATION_API_KEY` | مفتاح سري طويل (انسخه — هذا `WHATSAPP_API_KEY`) |
| `SERVER_URL` | `https://your-app.up.railway.app` |
| `DATABASE_ENABLED` | `true` |
| `DATABASE_PROVIDER` | `postgresql` |

4. انسخ **Public URL** للخدمة → هذا `WHATSAPP_API_URL`.

### الخيار ب — Render

1. **New → Web Service** من Docker image: `atendai/evolution-api:v2.1.1` (أو آخر إصدار v2).
2. أضف **PostgreSQL** كـ Render Postgres.
3. Environment:

```env
AUTHENTICATION_API_KEY=your-secret-key-min-32-chars
SERVER_URL=https://evolution-xxx.onrender.com
DATABASE_ENABLED=true
DATABASE_CONNECTION_URI=postgresql://...
```

4. Disk (اختياري لكن مُفضّل): mount `/evolution/instances`.

### الخيار ج — VPS + Docker

من مجلد المشروع:

```bash
cd deploy/evolution-api
cp .env.example .env
# عدّل AUTHENTICATION_API_KEY و SERVER_URL
docker compose up -d
```

---

## 2) إعداد Next.js (Master Clinic Plus)

في `.env.local` (محلياً) وفي **Vercel / Render** (إنتاج):

```env
# عنوان Evolution بدون / في النهاية
WHATSAPP_API_URL=https://your-evolution.up.railway.app

# نفس AUTHENTICATION_API_KEY من سيرفر Evolution
WHATSAPP_API_KEY=your-secret-key-min-32-chars

# اسم instance واحد للعيادة (حروف إنجليزية بدون مسافات)
WHATSAPP_INSTANCE_NAME=master_clinic

# evolution (افتراضي) | legacy لجسر قديم مخصص
WHATSAPP_PROVIDER=evolution

# اختياري — رقمك لاختبار الإشعار من صفحة المرضى
WHATSAPP_TEST_PHONE=07XXXXXXXXX
```

---

## 3) ربط الواتساب من الواجهة

1. شغّل التطبيق: `npm run dev`
2. ادخل **لوحة التحكم → واتساب** (`/dashboard/whatsapp`)
3. اضغط **عرض رمز QR**
4. على جوال العيادة: WhatsApp → **الأجهزة المرتبطة** → **ربط جهاز** → امسح الرمز
5. خلال ثوانٍ تتحول الحالة إلى **متصل** ويظهر «واتساب مربوط ✓»

الكود يعرض QR هكذا:

```tsx
// src/app/dashboard/whatsapp/page.tsx
<img src={qrImage} alt="رمز QR" />  // qrImage = data:image/png;base64,... من API
```

---

## 4) اختبار الإرسال

**ملاحظة:** لا يوجد حالياً Webhook لاستقبال رسائل واردة من Evolution. خطأ «لا توجد عيادة» يأتي من مسار **الإرسال** (`POST /api/whatsapp/test`) عندما لا يُعثر على `clinic_id` لحسابك — وليس من بحث برقم واتساب في قاعدة البيانات.

إذا ظهر الخطأ بعد التحديث: من Supabase نفّذ `SELECT public.link_profile_to_first_clinic();` ثم أعد تسجيل الدخول.


- من **ملفات المرضى** → **اختبار الإشعار**
- أو من Supabase/logs ابحث عن `[whatsapp]`

طلب Evolution يدوياً:

```bash
curl -X POST "https://YOUR-EVOLUTION/message/sendText/master_clinic" \
  -H "apikey: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"number":"9647XXXXXXXXX","text":"مرحباً من العيادة"}'
```

`number` بدون `+` — النظام يحوّل تلقائياً من `07...` إلى `9647...`.

---

## 5) مسارات API في المشروع

| المسار | الوظيفة |
|--------|---------|
| `GET /api/whatsapp/qr` | QR فقط عندما الجلسة **ليست** `open` (لا يستدعي `/connect` أثناء الاتصال) |
| `GET /api/whatsapp/status` | حالة موحّدة من `connectionState` + `fetchInstances` + تحديث `whatsapp_linked` |
| `POST /api/whatsapp/send` | إيصال دفع / تأكيد موعد |
| `POST /api/whatsapp/test` | رسالة تجريبية |

الكود المركزي: `src/lib/whatsapp/evolution-client.ts`

---

## 6) خطأ «Couldn't link device» على الجوال

1. في التطبيق: **QR جديد (بعد خطأ الربط)** ثم امسح خلال **20 ثانية**.
2. احذف جهازاً قديماً من واتساب → الأجهزة المرتبطة (الحد 4 أجهزة).
3. على **Railway (Evolution)**:
   - `CONFIG_SESSION_PHONE_VERSION=` **فارغ** (لا تثبت رقم إصدار قديم).
   - `SERVER_URL=https://evolution-api-production-xxxx.up.railway.app` (نفس الرابط العام).
   - حدّث Docker image إلى `evoapicloud/evolution-api:v2.3.6` أو أحدث.
   - أعد **Deploy** ثم جرّب QR جديداً.
4. انتظر حتى يظهر «متصل» في الصفحة قبل إغلاقها.

---

## 7) استكشاف الأخطاء

| المشكلة | الحل |
|---------|------|
| لا يظهر QR | تحقق من `WHATSAPP_API_URL` و `WHATSAPP_API_KEY`؛ افتح `/instance/connect/master_clinic` في المتصفح مع header `apikey` |
| QR يختفي بسرعة | اضغط «عرض رمز QR» مرة أخرى — Baileys يحدّث كل ~20 ثانية |
| **متصل على الجوال لكن الموقع يعود «غير متصل»** | انظر القسم 8 أدناه — غالباً ليس Webhooks |
| الرسالة لا تصل | تأكد `connectionState` = `open`؛ راجع logs Evolution |
| `401` | مفتاح `apikey` خاطئ |
| Render ينام | استخدم Railway أو خطة مدفوعة / UptimeRobot ping |

---

## 8) «متصل» على الجوال ثم يختفي في الموقع

التطبيق **لا يعتمد على Webhooks** من Evolution — يستخدم **polling** كل 4–30 ثانية على `/api/whatsapp/status`. إعداد Webhooks في Evolution اختياري ولا يحل هذا السلوك وحده.

### سبب شائع (تم إصلاحه في الكود)

استدعاء `GET /instance/connect/{instance}` بينما الجلسة **مفتوحة** (`open`) يعيد QR جديد وقد يقطع الربط. الصفحة كانت تُحدّث QR كل 15 ثانية حتى بعد الاتصال.

### خطوات فحص يدوية

1. **من المتصفح (بعد تسجيل الدخول للعيادة):**
   - افتح `GET /api/whatsapp/status` — يجب أن يبقى `"linked": true` و `"state": "open"`.
2. **مباشرة على Evolution (curl):**
   ```bash
   curl -s "https://YOUR-EVOLUTION/instance/connectionState/master_clinic" -H "apikey: YOUR_KEY"
   curl -s "https://YOUR-EVOLUTION/instance/fetchInstances" -H "apikey: YOUR_KEY"
   ```
   إذا `connectionState` = `open` لكن الموقع يعرض غير متصل → المشكلة في Next.js/المتغيرات وليس الهاتف.
3. **Railway → Evolution logs:** ابحث عن `Log out instance` أو `401` — يعني أن أحدهم استدعى logout/restart أو `/connect` بشكل متكرر.
4. **لا تضغط «QR جديد»** إلا لإعادة الربط عمداً — الزر يستدعي logout.
5. **Next.js على Railway:** نفس `WHATSAPP_API_URL` و `WHATSAPP_API_KEY` كما في Evolution، ثم Redeploy.

---

## 9) أمان

- لا تضع `WHATSAPP_API_KEY` في كود الواجهة (Client) — فقط في Server `.env`
- استخدم HTTPS على Evolution و Next.js
- مفتاح API قوي ولا تشاركه
