# نشر Master Clinic Plus على Vercel + Supabase

دليل خطوة بخطوة لرفع التطبيق على رابط دائم (HTTPS) يعمل من الموبايل، مع قاعدة بيانات Supabase.

---

## المتطلبات

- حساب [GitHub](https://github.com) (أو GitLab/Bitbucket)
- حساب [Vercel](https://vercel.com) (مجاني للمشاريع الشخصية)
- مشروع [Supabase](https://supabase.com) جاهز (جداول + RLS مطبّقة)
- الكود في مجلد التطبيق: `Master_clinic_plus/` (يحتوي `package.json` و `src/`)

---

## 1) تجهيز Supabase

1. افتح [Supabase Dashboard](https://supabase.com/dashboard) → مشروعك.
2. **Settings → API** انسخ:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (سري — لا تعرضه في المتصفح)
3. **Authentication → URL Configuration** (مهم بعد النشر):
   - **Site URL**: `https://YOUR-APP.vercel.app`
   - **Redirect URLs** أضف:
     - `https://YOUR-APP.vercel.app/**`
     - `http://localhost:3000/**` (للتطوير المحلي)
4. إن لم تكن الجداول جاهزة، نفّذ في SQL Editor بالترتيب:
   - `supabase/scripts/bootstrap_initial_schema_safe.sql`
   - ثم migrations من `supabase/migrations/` حسب ما ينطبق على مشروعك (بدون إعادة تشغيل `initial_schema` إذا ظهر `user_role already exists`).

---

## 2) رفع الكود إلى GitHub

من PowerShell (استبدل المسار إن لزم):

```powershell
cd "c:\Users\BRQ\Downloads\Master_clinic_plus\Master_clinic_plus"
git init
git add .
git commit -m "Initial commit — Master Clinic Plus"
git branch -M main
git remote add origin https://github.com/YOUR_USER/master-clinic-plus.git
git push -u origin main
```

> لا ترفع ملف `.env.local` — تأكد أنه في `.gitignore`.

---

## 3) ربط المشروع بـ Vercel

1. ادخل [vercel.com/new](https://vercel.com/new).
2. **Import** مستودع GitHub الذي أنشأته.
3. **Root Directory**: إن كان المستودع يحتوي مجلداً داخلياً، اختر `Master_clinic_plus` (المجلد الذي فيه `package.json`).
4. **Framework Preset**: Next.js (يُكتشف تلقائياً).
5. **Build Command**: `npm run build` (افتراضي).
6. **Output**: افتراضي Next.js.

---

## 4) متغيرات البيئة على Vercel

في مشروع Vercel: **Settings → Environment Variables** أضف لكل من Production و Preview:

| المتغير | الوصف |
|---------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | رابط مشروع Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | المفتاح العام anon |
| `SUPABASE_SERVICE_ROLE_KEY` | مفتاح service_role (سري) |
| `ADMIN_EMAIL` | بريد المدير العام |
| `PLATFORM_DEVELOPER_SECRET` | سلسلة عشوائية 32+ حرف |
| `PLATFORM_DEVELOPER_PASSWORD_HASH` | من `node scripts/hash-developer-password.mjs "كلمة-المرور"` |

اختياري (واتساب):

| المتغير | الوصف |
|---------|--------|
| `WHATSAPP_API_URL` | عنوان Evolution API |
| `WHATSAPP_API_KEY` | مفتاح API |
| `WHATSAPP_INSTANCE_NAME` | اسم الـ instance |
| `WHATSAPP_PROVIDER` | `evolution` |

> للتطوير المحلي فقط يمكن `ADMIN_PASSWORD` — على الإنتاج استخدم `PLATFORM_DEVELOPER_PASSWORD_HASH` فقط.

بعد الحفظ: **Deployments → Redeploy** لتطبيق المتغيرات.

---

## 5) النشر والرابط الدائم

1. اضغط **Deploy** — بعد نجاح البناء يظهر رابط مثل:  
   `https://master-clinic-plus.vercel.app`
2. انسخ الرابط وافتحه من الموبايل.
3. ارجع لـ Supabase **Authentication → URL Configuration** وحدّث **Site URL** و **Redirect URLs** بالرابط الفعلي من Vercel.
4. (اختياري) **Settings → Domains** في Vercel لربط نطاقك الخاص.

---

## 6) PWA من الموبايل

1. افتح الرابط في Chrome (Android) أو Safari (iPhone).
2. **Android**: قد يظهر شريط «تثبيت» أو من القائمة ⋮ → **Install app** / **إضافة إلى الشاشة الرئيسية**.
3. **iPhone**: زر المشاركة → **Add to Home Screen**.
4. بعد التثبيت يفتح التطبيق بملء الشاشة (`standalone`) من أيقونة **MC+**.

---

## 7) التحقق بعد النشر

- [ ] `/login` — الدخول لكل بوابة (طبيب / إدارة / محاسب)
- [ ] `/doctor` — المحفظة والمرضى على الموبايل
- [ ] `/admin` — لوحة المالك
- [ ] `/admin-login` — المدير العام (إن فعّلت البوابة)
- [ ] تغيير كلمة المرور من `/doctor/profile` و `/admin/profile`
- [ ] تسجيل الخروج يعمل ويعيدك لصفحة الدخول المناسبة

---

## استكشاف الأخطاء

| المشكلة | الحل |
|---------|------|
| `Invalid API key` | راجع `NEXT_PUBLIC_SUPABASE_*` على Vercel |
| تسجيل دخول يعيد لـ localhost | حدّث Site URL في Supabase |
| 500 على `/api/developer/*` | تأكد من `SUPABASE_SERVICE_ROLE_KEY` و `PLATFORM_DEVELOPER_*` |
| PWA لا يُثبّت | يجب HTTPS (Vercel يوفره)؛ امسح cache المتصفح |
| Build فشل على Vercel | شغّل محلياً `npm run build` واصلح الأخطاء قبل push |

---

## تحديثات لاحقة

كل `git push` إلى `main` يعيد النشر تلقائياً على Vercel. غيّر متغيرات البيئة من لوحة Vercel دون تعديل الكود.
