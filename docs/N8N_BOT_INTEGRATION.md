# ربط N8N Bot بـ Master Clinic Plus

هذا الملف موجّه لفريق N8N (صديقك) — يشرح كل ما يلزم للربط: المصادقة، الحجز،
الاستعلام، الإلغاء، وأحداث الـ webhook الصادرة من Master Clinic.

**مبدأ أساسي:** كل عيادة معزولة بالكامل عن غيرها — مفتاح API مختلف، رقم/أرقام
واتساب مختلفة، و webhook URL مختلف. تفعيل الربط لعيادة **لا يغيّر** أي شيء في
عيادة أخرى، ولا يغيّر سلوك النظام الحالي (Evolution) إلا للعيادة التي تُفعَّل
فيها N8N بوضوح.

---

## 1) المصادقة — مفتاح API لكل عيادة

كل طلب من N8N إلى Master Clinic يجب أن يحمل الترويسة:

```
X-Bot-Api-Key: mcp_bot_xxxxxxxx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- المفتاح يُولَّد من طرفنا لكل عيادة على حدة (سكربت داخلي)، ويُعرض **مرة واحدة فقط**.
- المفتاح يحدد العيادة تلقائياً — لا حاجة لإرسال `clinic_id` في أي طلب.
- إذا كان المفتاح غير صالح أو العيادة معطّلة → الرد `401`.

اختبار سريع:

```
GET /api/bot/health
X-Bot-Api-Key: <المفتاح>

→ { "ok": true, "clinic_id": "..." }
```

---

## 2) Base URL

```
https://master-clinic-plus-zg29.vercel.app
```

---

## 3) استعلام بيانات العيادة والأطباء

```
GET /api/bot/clinic
X-Bot-Api-Key: <المفتاح>
```

```json
{
  "clinic_id": "c1d2e3f4-...",
  "clinic_name": "عيادة النور للأسنان",
  "booking_code": "ALNOOR",
  "address": "الديوانية، شارع الجمهورية",
  "phone": "07701234567",
  "doctors": [
    { "id": "doc_uuid", "name": "د. أحمد الربيعي", "specialty": "أسنان" }
  ]
}
```

> **شرط:** يجب أن تكون وحدة "الحجز الإلكتروني" (`online_booking`) مفعّلة لهذه
> العيادة من لوحة التحكم (`/dashboard/booking`) — نفس الشرط المستخدم في بوابة
> الحجز العامة، نعيد استخدامه هنا بدل بناء بوابة صلاحيات جديدة.

---

## 4) الأوقات المتاحة

```
GET /api/bot/availability?doctorId=doc_uuid&date=2026-07-20&slotMinutes=30&from=09:00&to=21:00
X-Bot-Api-Key: <المفتاح>
```

- `doctorId`, `date` مطلوبان. `slotMinutes` (افتراضي 30)، `from`/`to` (افتراضي 09:00–21:00) اختيارية.
- لا يوجد جدول دوام رسمي في النظام اليوم — هذه نافذة عمل افتراضية قابلة للتخصيص عبر `from`/`to` في كل طلب.

```json
{
  "date": "2026-07-20",
  "doctor_id": "doc_uuid",
  "doctor_name": "د. أحمد الربيعي",
  "slot_minutes": 30,
  "from": "09:00",
  "to": "21:00",
  "available_slots": [
    { "start": "09:00", "end": "09:30" },
    { "start": "09:30", "end": "10:00" }
  ],
  "busy_slots": [
    { "start": "10:00", "end": "10:30" }
  ]
}
```

---

## 5) حجز موعد جديد

```
POST /api/bot/appointments
X-Bot-Api-Key: <المفتاح>
Content-Type: application/json

{
  "doctorId": "doc_uuid",
  "patientName": "علي حسين محمد",
  "patientPhone": "07801234567",
  "appointmentDate": "2026-07-20",
  "startTime": "10:00",
  "endTime": "10:30",
  "notes": "ألم في الضرس الخلفي"
}
```

- الهاتف يُقبل بصيغة `07xxxxxxxxx` أو `+9647xxxxxxxx` — يُطبَّع تلقائياً.
- الموعد يُحفظ بحالة `pending` ويظهر فوراً عند المحاسب (Realtime).
- يُعلَّم داخلياً بـ `source = "whatsapp_bot"` — يساعد في تمييز حجوزات البوت.

```json
{
  "appointment_id": "appt_uuid",
  "status": "pending",
  "message": "تم تسجيل موعدك بنجاح، بانتظار تأكيد العيادة"
}
```

أخطاء محتملة (رد `400`): وقت محجوز مسبقاً، طبيب غير موجود، رقم هاتف غير صالح.

---

## 6) استعلام مواعيد مراجع بهاتفه

```
GET /api/bot/appointments?phone=07801234567
X-Bot-Api-Key: <المفتاح>
```

```json
{
  "appointments": [
    {
      "appointment_id": "appt_uuid",
      "doctor_id": "doc_uuid",
      "doctor_name": "د. أحمد الربيعي",
      "appointment_date": "2026-07-20",
      "start_time": "10:00:00",
      "end_time": "10:30:00",
      "status": "pending",
      "notes": "ألم في الضرس الخلفي"
    }
  ]
}
```

يعرض فقط المواعيد **القادمة** (من اليوم فصاعداً) وغير الملغاة.

---

## 7) إلغاء موعد

```
PATCH /api/bot/appointments/{appointment_id}/cancel
X-Bot-Api-Key: <المفتاح>
Content-Type: application/json

{
  "patientPhone": "07801234567",
  "reason": "طلب المراجع الإلغاء عبر واتساب"
}
```

- **يجب** أن يطابق `patientPhone` رقم صاحب الموعد المسجَّل — وإلا رد `400`.
- يمكن إلغاء الحالات: `pending`, `scheduled`, `confirmed`, `waiting` فقط.

```json
{ "success": true, "message": "تم إلغاء الموعد" }
```

---

## 8) أحداث Master Clinic → N8N (Webhook صادر)

عند أي تحديث لموعد (تقديم، موافقة، رفض، تعديل، إلغاء) — إذا كانت العيادة
مفعّلة على `provider = n8n_bot`، يُرسل Master Clinic طلب `POST` موقّع HMAC إلى
`webhook_url` الخاص بالعيادة (مسجَّل مسبقاً من طرفنا).

### الترويسات

```
Content-Type: application/json
X-MC-Clinic-Id: c1d2e3f4-...
X-MC-Event: appointment.accepted
X-MC-Signature: <hmac-sha256-hex>
```

### التحقق من التوقيع (HMAC-SHA256)

```js
const crypto = require("crypto");
const expected = crypto
  .createHmac("sha256", WEBHOOK_SECRET)
  .update(rawRequestBody) // نص JSON الخام كما وصل، بدون إعادة تنسيق
  .digest("hex");

if (expected !== headers["x-mc-signature"]) {
  throw new Error("توقيع غير صالح");
}
```

### صيغة الجسم (لكل الأحداث)

```json
{
  "event": "appointment.accepted",
  "clinic_id": "c1d2e3f4-...",
  "idempotency_key": "evt_...",
  "timestamp": "2026-07-20T09:15:00.000Z",
  "data": {
    "appointment_id": "appt_uuid",
    "patient_name": "علي حسين محمد",
    "patient_phone": "+9647801234567",
    "doctor_name": "د. أحمد الربيعي",
    "appointment_date": "2026-07-20",
    "start_time": "10:00",
    "end_time": "10:30",
    "status": "waiting",
    "reason_for_change": null,
    "clinic_name": "عيادة النور للأسنان",
    "clinic_address": "الديوانية، شارع الجمهورية",
    "source": "whatsapp_bot"
  }
}
```

### كتالوج الأحداث

| event | يُطلَق عند |
|---|---|
| `appointment.submitted` | حجز جديد (بوابة عامة، أو `POST /api/bot/appointments`) |
| `appointment.accepted` | المحاسب/المساعد يوافق على طلب `pending` |
| `appointment.rejected` | رفض طلب `pending` |
| `appointment.modified` | تعديل تاريخ/وقت/بيانات موعد |
| `appointment.cancelled` | إلغاء موعد مؤكَّد (من الموظف أو من `PATCH .../cancel`) |
| `appointment.created` | حجز يدوي مباشر من الموظف (بدون مرحلة pending) |
| `message.text` | أي رسالة نصية أخرى يريد النظام إرسالها للمراجع (إيصال دفع، ملخص جلسة...) |
| `message.document` | فاتورة PDF أو وصفة PDF جاهزة للإرسال — تصل كرابط موقّع، ليس Base64 |

### صيغة `message.text`

```json
{
  "event": "message.text",
  "clinic_id": "c1d2e3f4-...",
  "idempotency_key": "evt_...",
  "timestamp": "2026-07-20T09:15:00.000Z",
  "data": {
    "phone": "+9647801234567",
    "message": "شكراً لك، تم استلام دفعتك بقيمة 25000 د.ع...",
    "message_type": "payment_receipt"
  }
}
```

### صيغة `message.document`

```json
{
  "event": "message.document",
  "clinic_id": "c1d2e3f4-...",
  "idempotency_key": "evt_...",
  "timestamp": "2026-07-20T09:15:00.000Z",
  "data": {
    "phone": "+9647801234567",
    "caption": "📎 إيصال الدفع — PDF",
    "file_name": "invoice-123.pdf",
    "message_type": "session_invoice_pdf",
    "document_url": "https://.../bot-outbound-documents/....pdf?token=..."
  }
}
```

- `document_url` رابط موقّع (Signed URL) صالح لمدة **24 ساعة فقط** — نزّلوه
  وأرسلوه فوراً عبر واتساب، لا تخزّنوه للأمد الطويل.
- `message_type` قيم شائعة: `session_invoice_pdf` (فاتورة)، `prescription_pdf`
  (وصفة)، `payment_receipt` (إيصال دفع نصي)، `session_invoice` (ملخص جلسة نصي).
  عاملوا أي قيمة غير معروفة كرسالة/مرفق عام وأرسلوه كما هو دون رفضه.

### مهم — تجنّب الرسائل المكررة

- `data.source` يخبرك من بدأ الحجز: `"whatsapp_bot"` = المراجع حجز عبر بوتك
  أنت أصلاً. عند استلام `appointment.submitted` بـ `source: "whatsapp_bot"`،
  **تجاهله** لأن ردّك على المراجع أصلاً كان مباشرة بعد استدعائك لـ
  `POST /api/bot/appointments` — لا حاجة لإرسال رسالة ثانية.
- استخدم `idempotency_key` لتجاهل أي حدث مكرر (نادر، فقط عند إعادة محاولة الشبكة).
- بمجرد تفعيل `provider = n8n_bot` لعيادة، **Master Clinic لا يرسل Evolution
  إطلاقاً** لتلك العيادة — أنتم المصدر الوحيد للرسائل.

### إعادة المحاولة عند فشل webhook

إذا فشل استلام الحدث (شبكة، 5xx، انقطاع)، يُسجَّل الحدث في طابور داخلي لدينا
(`automation_outbox`) لإعادة المحاولة لاحقاً (المعالجة اليدوية/التلقائية لهذا
الطابور جزء من مرحلة تالية — أُخطركم عند تفعيلها).

---

## 9) ما هو مؤجَّل لمرحلة قادمة (غير مُفعَّل اليوم)

- إرسال الأشعة (`xray.uploaded`) عبر webhook — لا يزال هذا يمر بمسار Evolution
  الداخلي حتى اليوم. الفواتير والوصفات (`message.document`) **مُفعَّلة الآن**
  (انظر القسم 8).

---

## 10) كيف نفعّل/نعدّل عيادة عندنا

عبر لوحة المطور (الطريقة المعتمدة): صفحة العيادة → قسم "ربط N8N" → توليد/تدوير
مفتاح API، تحديد `webhook_url` وأرقام واتساب، ثم نسخ "بلوك الربط" الجاهز
لإرساله لكم مباشرة (يحتوي Clinic ID + Bot API Key + Webhook Secret).

بديل عبر الطرفية (سكربت داخلي — نادراً نحتاجه بعد إضافة لوحة المطور):

```bash
node scripts/manage-bot-integration.mjs --clinic-id=UUID --enable \
  --webhook-url=https://n8n.example.com/webhook/clinic-events \
  --numbers=+9647801234567,+9647809876543
```

يُطبع المفتاح الكامل و `webhook_secret` مرة واحدة — نرسلها لكم بقناة آمنة.

---

## 11) ملاحظات توافق مع نسخة الوركفلو "إدارة واتس اب العيادات v3"

راجعنا ملف الوركفلو الذي أرسلتوه. هذه ملاحظات دقيقة لكل عقدة (node) تحتاج
تعديلاً بسيطاً، وأخرى **أصبحت متوافقة تلقائياً بدون أي تعديل** بعد تحديثنا:

### ✅ متوافق تلقائياً بدون أي تعديل من طرفكم

- **عقدة "Verify HMAC Signature"**: تتحقق من `x-signature` أو `x-signature-256`
  بصيغة `sha256=<hex>`. أصبحنا نُرسل هذه الترويسة (`X-Signature-256`) بالإضافة
  إلى `X-MC-Signature` القديمة — فقط ضعوا `APPOINTMENT_WEBHOOK_SECRET` = نفس
  `webhook_secret` من بلوك الربط.
- **عقدة "Self-Origin Event?"**: تتحقق من `$json.body.source === "whatsapp_bot"`.
  أصبحنا نكرّر `source` على مستوى جذر الـ JSON (وليس فقط داخل `data`) — يعمل
  بدون تعديل.
- **عقدة "Create Appointment via Bot API"**: ترويسة `X-API-Key` تُقبل الآن
  كمرادف لـ `X-Bot-Api-Key`. وحقول الجسم `name` / `phone` / `date` (بصيغة ISO
  كاملة `2026-10-25T16:00:00+03:00`) تُقبل كمرادفات لـ `patientName` /
  `patientPhone` / `appointmentDate`+`startTime`. الحقول الزائدة
  (`idempotency_key`, `source`, `clinic_id`, `age`) تُتجاهَل بأمان.

### ✏️ يحتاج تعديل نصّي بسيط (Placeholder فقط)

- **عقدة "Create Appointment via Bot API" → URL**: غيّروا
  `https://YOUR-BOT-API-DOMAIN/clinics/{id}/appointments` إلى:

  ```
  https://master-clinic-plus-zg29.vercel.app/api/bot/appointments
  ```

  (لا حاجة لـ `clinic_id` في المسار — مفتاح API يحدد العيادة تلقائياً.)

- **متغيرات Notion الخاصة بكم** (`TODO_REPLACE_WITH_CLINICS_REGISTRY_DB_ID`,
  `TODO_REPLACE_WITH_PROCESSED_EVENTS_DB_ID`): هذه قواعد Notion خاصة بنظامكم
  فقط، لا علاقة لنا بها — عبّوها بمعرّفات قواعدكم الحقيقية.
- **سجلّ العيادات في Notion** ("Lookup Clinic Registry (WA)" /
  "(Webhook)"): لكل عيادة تفعّلونها، خزّنوا فيه ثلاث قيم من "بلوك الربط" الذي
  ننسخه من لوحة المطور: `Clinic ID`، `Bot API Key`، بالإضافة إلى
  `WhatsApp Phone Number ID` الخاص برقم واتساب تلك العيادة (من طرفكم).

### ⚠️ توصية مهمة — منع الحجز المكرر (سبب المشروع الأصلي)

عقدة **"Intake & Booking"** تتحقق من التعارض حالياً فقط عبر أداة
`Get many database pages in Notion` (قاعدتكم الخاصة). هذه القاعدة **لا تعرف**
بالحجوزات التي يسويها المحاسب مباشرة داخل Master Clinic (حجز حضوري، أو حجز
إلكتروني من الموقع). لتفادي التعارض الحقيقي، نوصي بإضافة استدعاء (كأداة AI
Tool أو خطوة قبل التثبيت) إلى:

```
GET /api/bot/availability?doctorId=...&date=YYYY-MM-DD
X-Bot-Api-Key: <المفتاح>
```

هذا يعكس **كل** حجوزات العيادة الحقيقية (بوت + محاسب + حجز إلكتروني) لحظياً.
كذلك — بما أن الحجز الحالي لا يحدد `doctorId` أبداً، والعيادة قد تحتوي أكثر
من طبيب: استدعوا `GET /api/bot/clinic` أول مرة بالمحادثة لعرض قائمة الأطباء
وسؤال المريض عن تفضيله، ثم أرسلوا `doctorId` المختار مع الحجز. إذا لم يُرسَل
`doctorId` والعيادة تحتوي طبيباً واحداً فقط نشطاً، نختاره تلقائياً؛ إذا كانت
تحتوي أكثر من طبيب سيرجع الطلب خطأ `400` مع قائمة الأطباء ليعاد المحاولة.
