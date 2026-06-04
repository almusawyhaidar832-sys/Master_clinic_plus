# نظام Multi-Tenant — Master Clinic Plus

## هرمية الصلاحيات

| المستوى | الدخول | النطاق |
|---------|--------|--------|
| **المدير العام (المنصة)** | «دخول المطور» → `/developer/login` | كل العيادات، إنشاء عيادات، Evolution instances |
| **مالك العيادة (Owner)** | `/login` → محاسب/مالك | `super_admin` + `clinic_id` — عيادته فقط |
| **المحاسب** | `/login` → محاسب | `accountant` + `clinic_id` |
| **الطبيب** | `/login` → طبيب | `doctor` + `clinic_id` |

المدير العام **ليس** مستخدماً في Supabase Auth بالضرورة — جلسة منفصلة (cookie موقّع).

## عزل البيانات

- كل الجداول التشغيلية تحتوي `clinic_id`.
- RLS: `tenant_can_access(clinic_id)` ↔ نفس `profiles.clinic_id` **أو** `is_platform_admin()`.
- مالك العيادة (`super_admin` + `clinic_id`) يرى عيادته فقط.
- **المدير العام** (بريد `platform_settings.admin_email`) يرى كل الجداول.

### SQL دفعة واحدة (Supabase SQL Editor)

شغّل الملف:

`supabase/scripts/APPLY_MULTI_TENANT_COMPLETE.sql`

يضيف أعمدة `clinics`: `whatsapp_instance_name`, `whatsapp_api_key`, `owner_email`, `is_active` — ويبقي `whatsapp_session_id` للتوافق مع التطبيق.

## إنشاء عيادة تلقائياً

من `/developer` → **إضافة عيادة جديدة**:

1. سجل في `clinics`
2. `seed_clinic_settings`
3. حساب Auth + `profiles` بدور **`super_admin`** (Owner)
4. إنشاء Evolution instance وحفظ الاسم في `whatsapp_session_id`

API: `POST /api/developer/clinics`

## لوحة المدير العام (`/developer`)

- **إحصائيات:** إجمالي العيادات، المرضى، واتساب المتصل
- **جدول العيادات:** اسم، تاريخ، مرضى، حالة واتساب، تفعيل/تعطيل
- **إجراءات:** تعديل، إعادة تعيين Evolution، حذف (تأكيد)
- **دخول نيابةً (Impersonation):** `POST /api/developer/enter-clinic` — فتح `/dashboard` بدون كلمة سر المالك

طبّق migration: `20260606100000_clinic_is_active.sql`

## تسجيل دخول المدير العام

في `.env.local` (لا ترفع الملف إلى Git):

```env
ADMIN_EMAIL=your-email@gmail.com
PLATFORM_DEVELOPER_SECRET=سر-عشوائي-32-حرفاً-أو-أكثر

# الأفضل: كلمة مرور مُهشّاة
PLATFORM_DEVELOPER_PASSWORD_HASH=<من السكربت أدناه>
```

توليد الـ HASH:

```bash
# بعد ضبط PLATFORM_DEVELOPER_SECRET في الطرفية
node scripts/hash-developer-password.mjs "كلمة-السر-الخاصة"
```

بديل مؤقت للتطوير فقط (نص في env):

```env
ADMIN_PASSWORD=...
```

الجلسة: **30 يوماً** — cookie `httpOnly` موقّع بـ HMAC.

## Supabase

طبّق migration:

`supabase/migrations/20260606000000_multi_tenant_hardening.sql`
