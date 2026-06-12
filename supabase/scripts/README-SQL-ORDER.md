# Supabase — شنو تشغّل وبالترتيب؟

**ما تحتاج تسأل «أشغّل RLS لوحده؟»** — ملف **APPLY_MULTI_TENANT_COMPLETE.sql** **هو** RLS + عزل العيادات + الدوال. ملف واحد.

---

## 1) مرة واحدة (عزل العيادات — Multi-Tenant)

في **Supabase → SQL Editor** شغّل **من البداية للنهاية**:

```
supabase/scripts/APPLY_MULTI_TENANT_COMPLETE.sql
```

إذا طلع خطأ → شغّل ملف الإصلاح المناسب ثم **أعد** السكript الكامل:

| خطأ | ملف الإصلاح |
|-----|----------------|
| `clinics_platform_insert already exists` | `41-fix-clinics-policies-rerun.sql` |
| `link_profile_to_first_clinic not found` | `42-fix-link-profile-function.sql` |

**نجاح:** في النهاية تظهر رسائل `NOTICE` مثل `✓ Multi-tenant applied`.

---

## 2) سكربتات إضافية (حسب الميزة — مو كلها RLS)

شغّلها **فقط** إذا تستخدم الميزة وما شغّلت migration من قبل:

| # | الملف | ليش |
|---|--------|-----|
| 38 | `38-freeze-doctor-share-on-payment.sql` | تجميد نسبة الطبيب عند الدفع |
| 39 | `39-queue-doctor-transfer-reject.sql` | رفض/تحويل من الطبيب في الانتظار |
| 40 | `40-push-subscriptions.sql` | تنبيهات موبايل الطبيب (PWA) |

---

## 3) ما تشغّله

- **`.env.local`** — على جهازك فقط، مو Supabase
- **نفس السكript أكثر من مرة** — OK بعد التصليحات (idempotent)
- **RLS منفصل** — مو مطلوب؛ موجود داخل APPLY_MULTI_TENANT_COMPLETE

---

## 4) بعد SQL

1. أعد تشغيل `npm run dev` (أو Vercel Redeploy)
2. من `/developer` جرّب إضافة عيادة ثانية
3. إذا حساب قديم بدون عيادة (نادر):  
   `SELECT public.link_profile_to_first_clinic();`

---

## 5) ملخص للمبتدئ

```
Supabase SQL Editor
    └── APPLY_MULTI_TENANT_COMPLETE.sql   ← هذا كل شي للعزل
    └── 38, 39, 40                        ← إضافات حسب الحاجة
```

**GitHub / Vercel** = الكود. **Supabase SQL** = قاعدة البيانات. شغلتين منفصلتين.
