# ماستر كلينك بلس — Master Clinic Plus

نظام إدارة عيادات متعدد المستأجرين (Multi-Tenant) بواجهة عربية كاملة، مبني على **Next.js 15 (App Router)** + **Tailwind CSS** + **Supabase**.

## الألوان

| الاستخدام | اللون |
|-----------|--------|
| أساسي (Teal) | `#14b8a6` |
| نص (Slate) | `#0f172a` |
| خلفية | `#f8fafc` |

## هيكل المجلدات

```
Master_clinic_plus/
├── public/
│   ├── manifest.json          # PWA للطبيب
│   ├── sw.js                  # Service Worker (offline)
│   └── icons/
├── supabase/
│   ├── migrations/
│   │   └── 20260523000000_initial_schema.sql
│   ├── seed.sql
│   └── config.toml
├── src/
│   ├── app/
│   │   ├── dashboard/         # محاسب / استقبال
│   │   ├── doctor/            # PWA الطبيب (7 خيارات)
│   │   ├── admin/             # Super Admin — أرباح وعيادات
│   │   ├── login/
│   │   └── api/whatsapp/
│   ├── components/
│   │   ├── ui/
│   │   ├── layout/
│   │   ├── accountant/
│   │   └── doctor/
│   ├── config/navigation.ts
│   ├── lib/                   # Supabase, finance, WhatsApp, offline
│   └── types/
├── tailwind.config.ts
└── package.json
```

## الوحدات الست

1. **أمان ومتعدد المستأجرين** — RBAC (`super_admin`, `accountant`, `doctor`) + RLS على `clinic_id`
2. **سجل المرضى** — إدخال سريع، حساب المتبقي، جدول يومي، ملف مريض موحد
3. **اتفاقيات الأطباء** — قوائم ثابتة للنسب (10–80%) وتكلفة المواد (0–50%)
4. **تطبيق الطبيب PWA** — محفظة، سحب، مرضى، تصفية تاريخ، مواعيد، علاجات غير مكتملة، كشف حساب + offline cache
5. **مصروفات ورواتب** — مصروفات نص حر + 7 موظفين + سلف/خصوم + قسيمة راتب
6. **واتساب وأرباح** — QR ربط، رسائل تأكيد موعد وإيصال دفع (بدون ذكر ديون)، لوحة أرباح المالك

## التشغيل

1. ثبّت [Node.js LTS](https://nodejs.org/) (مطلوب لـ `npm`).
2. انسخ `.env.local.example` إلى `.env.local` واملأ مفاتيح Supabase.
3. في [Supabase Dashboard](https://supabase.com) → SQL Editor: نفّذ ملف `supabase/migrations/20260523000000_initial_schema.sql`.
4. أنشئ مستخدم Auth ثم اربطه في `profiles` (راجع `supabase/seed.sql`).
5. ثبّت الحزم وشغّل:

```bash
npm install
npm run dev
```

افتح [http://localhost:3000](http://localhost:3000).

## PWA للطبيب

- افتح `/doctor` من الجوال → «إضافة إلى الشاشة الرئيسية».
- `manifest.json` + `sw.js` يخزنان الصفحات الأساسية و`localStorage` للرصيد وقائمة المرضى.

## WhatsApp

اربط جسراً (Evolution API أو مشابه) عبر `WHATSAPP_API_URL`. واجهة المسح: `/dashboard/whatsapp`.

## الأدوار

| الدور | المسار الرئيسي |
|-------|----------------|
| محاسب | `/dashboard` |
| طبيب | `/doctor` |
| مالك المنصة | `/admin/profits` |

---

© Master Clinic Plus — جاهز للتوسع بعدد غير محدود من العيادات.
