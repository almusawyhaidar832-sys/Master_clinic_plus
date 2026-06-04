# الوصول من الموبايل + النشر الاحترافي

## لماذا `26.205.134.192:3000` يعطي ERR_CONNECTION_TIMED_OUT؟

| السبب | الشرح |
|--------|--------|
| **ليس نفس الشبكة** | عنوان مثل `26.x.x.x` غالباً من **VPN** (مثل Radmin) وليس Wi‑Fi المنزل. الجوال على 4G أو Wi‑Fi آخر لن يصل. |
| **جدار الحماية** | Windows Firewall يحجب المنفذ 3000 من الأجهزة الأخرى. |
| **منفذ مختلف** | إن كان 3000 مشغولاً، Next يعمل على **3001** — والرابط يجب أن يطابق المنفذ الظاهر في الطرفية. |
| **السيرفر متوقف** | `npm run dev` غير شغّال على الكمبيوتر. |
| **IP محلي ≠ رابط دائم** | عند تغيير الشبكة أو إغلاق الحاسوب يتوقف الوصول — **الحل الاحترافي: Vercel + Supabase**. |

---

## أ) الوصول المحلي (نفس الشبكة / VPN)

### 1) تشغيل السيرفر لجميع الأجهزة على الشبكة

من مجلد التطبيق (`Master_clinic_plus` الذي فيه `package.json`):

```powershell
cd "c:\Users\BRQ\Downloads\Master_clinic_plus\Master_clinic_plus"
npm run dev:lan
```

هذا يشغّل: `next dev -H 0.0.0.0 -p 3000` — يقبل اتصالات من الموبايل وليس من `localhost` فقط.

### 2) اعرف عنوان IP الصحيح

في PowerShell على الكمبيوتر:

```powershell
ipconfig
```

- **Wi‑Fi نفس المنزل:** استخدم `IPv4` تحت **Wireless LAN** — غالباً `192.168.x.x`
- **VPN (Radmin):** استخدم IP الشبكة الافتراضية — قد يكون `26.205.134.x`

على الموبايل (نفس Wi‑Fi أو نفس VPN):

```text
http://192.168.1.XX:3000
```

أو إن كنت على VPN فقط:

```text
http://26.205.134.192:3000
```

> تأكد أن الرقم في الطرفية عند `Network:` يطابق ما تكتبه في المتصفح، وأن المنفذ **3000** وليس 3001.

### 3) فتح المنفذ في Windows Firewall (مرة واحدة)

**Settings → Windows Security → Firewall → Advanced settings → Inbound Rules → New Rule:**

- Port → TCP → **3000** → Allow → Private (و Domain إن لزم)

أو مؤقتاً للاختبار: اسمح لـ **Node.js** على الشبكات الخاصة.

### 4) تحديث Supabase للتطوير المحلي (اختياري)

في Supabase → **Authentication → URL Configuration** أضف:

- `http://192.168.1.XX:3000/**`
- `http://26.205.134.192:3000/**` (إن استخدمت VPN)

---

## ب) الحل الاحترافي — رابط دائم (Vercel)

**موصى به للعيادات:** HTTPS، يعمل من أي مكان، بدون IP محلي.

### الخطوات السريعة

| # | الخطوة |
|---|--------|
| 1 | مشروع Supabase جاهز + مفاتيح API |
| 2 | رفع الكود إلى GitHub (مجلد `Master_clinic_plus` داخل المستودع) |
| 3 | [vercel.com/new](https://vercel.com/new) → Import → **Root Directory** = `Master_clinic_plus` |
| 4 | إضافة متغيرات البيئة (انظر الجدول أدناه) |
| 5 | Deploy → انسخ الرابط `https://xxx.vercel.app` |
| 6 | Supabase → **Site URL** = رابط Vercel + **Redirect URLs** = `https://xxx.vercel.app/**` |
| 7 | من الموبايل افتح الرابط → ثبّت PWA من المتصفح (إضافة للشاشة الرئيسية) |

### متغيرات Vercel (إلزامية)

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ADMIN_EMAIL=your-email@gmail.com
PLATFORM_DEVELOPER_SECRET=random-32-chars-minimum
PLATFORM_DEVELOPER_PASSWORD_HASH=...
```

توليد hash كلمة مرور المطور:

```powershell
node scripts/hash-developer-password.mjs "YourPassword"
```

### دليل مفصّل

راجع: **`docs/VERCEL_DEPLOY.md`**

### Railway بدلاً من Vercel؟

- **Vercel:** الأفضل لـ Next.js (مجاني، CDN، HTTPS تلقائي).
- **Railway:** مناسب إذا أردت تشغيل **Evolution API (واتساب)** على نفس المنصة — التطبيق نفسه يبقى أنسب على Vercel وSupabase منفصل.

---

## ج) ماذا تختار للعيادة؟

| الاستخدام | التوصية |
|-----------|---------|
| تجربة سريعة في العيادة على نفس Wi‑Fi | `npm run dev:lan` + `192.168.x.x:3000` |
| استخدام يومي من أي مكان (أطباء / موظفين) | **Vercel + Supabase** |
| واتساب مستقر | Evolution على Railway/Render + متغيرات `WHATSAPP_*` على Vercel |

---

## استكشاف أخطاء سريع

```text
ERR_CONNECTION_TIMED_OUT  → شبكة / firewall / سيرفر متوقف / IP أو منفذ خاطئ
ERR_CONNECTION_REFUSED    → السيرفر لا يعمل على ذلك المنفذ
502 على Vercel            → متغيرات بيئة ناقصة أو build فاشل — راجع Deploy Logs
```

بعد النشر على Vercel لا تستخدم `26.205.134.192` — استخدم فقط رابط `https://....vercel.app`.
