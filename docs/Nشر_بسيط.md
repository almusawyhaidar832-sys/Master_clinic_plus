# نشر التطبيق على الإنترنت — دليل للمبتدئ

**ما تحتاج تفهم `.env.local` للنشر.**  
الملف `.env.local` يبقى على جهازك للتطوير فقط. للإنترنت ننسخ إعداداته **مرة واحدة** إلى Vercel.

---

## ملخص بثلاث جمل

1. **Supabase** = قاعدة البيانات (جاهزة عندك).
2. **Vercel** = يستضيف التطبيق ويعطيك رابط `https://....vercel.app`.
3. **`.env.local` لا يُرفع GitHub** — نستخدم ملف جاهز اسمه `deploy/vercel-env-import.env`.

---

## الخطوة 0 — تجهيز تلقائي (سوّيناه على جهازك)

من مجلد المشروع:

```powershell
node scripts/prepare-vercel-deploy.mjs
```

ينشئ الملف:

`deploy/vercel-env-import.env`

**هذا الملف فيه كل مفاتيحك** — لا تشاركه ولا ترفعه GitHub.

---

## الخطوة 1 — GitHub (مرة واحدة)

الكود عندك على:  
https://github.com/almusawyhaidar832-sys/Master_clinic_plus

إذا في تعديلات جديدة لم تُرفع:

```powershell
cd "c:\Users\a\Projects\Master_clinic_plus"
git add .
git commit -m "تحديثات التطبيق"
git push
```

---

## الخطوة 2 — Vercel (الاستضافة)

1. افتح https://vercel.com وسجّل دخول **بحساب GitHub** (نفس حساب المشروع).
2. **Add New → Project**.
3. اختر مستودع **Master_clinic_plus** → **Import**.
4. **Root Directory**: اتركه `.` (جذر المشروع — فيه `package.json`).
5. **قبل Deploy** — من الأسفل **Environment Variables**:
   - اضغط **Import .env**
   - اختر الملف من جهازك:  
     `c:\Users\a\Projects\Master_clinic_plus\deploy\vercel-env-import.env`
   - تأكد أن **Production** مفعّل.
6. اضغط **Deploy** وانتظر 2–5 دقائق.
7. انسخ الرابط الذي يظهر، مثل:  
   `https://master-clinic-plus-xxxx.vercel.app`

---

## الخطوة 3 — Supabase (بعد ما يظهر الرابط)

1. https://supabase.com/dashboard → مشروعك.
2. **Authentication → URL Configuration**:
   - **Site URL** = رابط Vercel (مثل `https://xxx.vercel.app`)
   - **Redirect URLs** أضف:
     - `https://xxx.vercel.app/**`
     - `http://localhost:3000/**` (للتطوير على جهازك)
3. احفظ.

ملف تذكير: `deploy/SUPABASE-AFTER-DEPLOY.txt`

---

## الخطوة 4 — SQL (إذا ما شغّلته)

في Supabase → **SQL Editor** شغّل بالترتيب أي سكربت ناقص، مثل:

- `supabase/scripts/40-push-subscriptions.sql` (تنبيهات موبايل الطبيب)

---

## الخطوة 5 — الموبايل (الأطباء والموظفين)

1. افتح رابط Vercel من Chrome (أندroid) أو Safari (آيفون).
2. **ثبّت التطبيق** على الشاشة الرئيسية (PWA).
3. الطبيب: **فعّل التنبيهات** من الشريط البنفسجي.
4. لا تستخدم `192.168.x.x` — فقط رابط `https://....vercel.app`.

---

## هل أحتاج أغيّر `.env.local` بعد النشر؟

| المكان | الغرض |
|--------|--------|
| `.env.local` على جهازك | تطوير محلي فقط (`npm run dev`) |
| Vercel Environment Variables | الإنتاج — العالم يرى هذا |
| `NEXT_PUBLIC_APP_URL` على Vercel | **اختياري** — على Vercel يُكتشف الرابط تلقائياً |

---

## تحديثات لاحقة

- أي `git push` إلى `main` → Vercel ينشر تلقائياً.
- تغيير كلمة مرور أو واتساب → عدّل في Vercel **Settings → Environment Variables** ثم **Redeploy**.

---

## مساعدة سريعة

| المشكلة | الحل |
|---------|------|
| تسجيل الدخول يرجع لـ localhost | حدّث Site URL في Supabase برابط Vercel |
| Build فشل | راجع Deploy Logs على Vercel |
| واتساب لا يعمل | تأكد `WHATSAPP_*` في Vercel |
| تنبيهات الطبيب | شغّل SQL 40 + ثبّت PWA + فعّل التنبيهات |

دليل تقني إضافي: `docs/VERCEL_DEPLOY.md`
