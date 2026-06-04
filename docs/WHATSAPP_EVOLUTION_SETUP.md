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
| `GET /api/whatsapp/qr` | إنشاء/الاتصال بالـ instance + إرجاع QR base64 |
| `GET /api/whatsapp/status` | حالة الاتصال + تحديث `clinics.whatsapp_linked` |
| `POST /api/whatsapp/send` | إيصال دفع / تأكيد موعد |
| `POST /api/whatsapp/test` | رسالة تجريبية |

الكود المركزي: `src/lib/whatsapp/evolution-client.ts`

---

## 6) استكشاف الأخطاء

| المشكلة | الحل |
|---------|------|
| لا يظهر QR | تحقق من `WHATSAPP_API_URL` و `WHATSAPP_API_KEY`؛ افتح `/instance/connect/master_clinic` في المتصفح مع header `apikey` |
| QR يختفي بسرعة | اضغط «عرض رمز QR» مرة أخرى — Baileys يحدّث كل ~20 ثانية |
| الرسالة لا تصل | تأكد `connectionState` = `open`؛ راجع logs Evolution |
| `401` | مفتاح `apikey` خاطئ |
| Render ينام | استخدم Railway أو خطة مدفوعة / UptimeRobot ping |

---

## 7) أمان

- لا تضع `WHATSAPP_API_KEY` في كود الواجهة (Client) — فقط في Server `.env`
- استخدم HTTPS على Evolution و Next.js
- مفتاح API قوي ولا تشاركه
