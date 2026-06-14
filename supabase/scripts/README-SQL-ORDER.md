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

## 2) فحص سريع — هل SQL مضبوط؟

في **Supabase → SQL Editor** شغّل:

```
supabase/scripts/SCHEMA_HEALTH_CHECK.sql
```

- **✅ OK** على كل الصفوف → قاعدة البيانات جاهزة
- **❌ ناقص** → شغّل الملف في عمود `fix_if_missing` ثم أعد الفحص

### فحص مالي (محفظة، أرباح، رواتب، فواتير)

```
supabase/scripts/FINANCIAL_HEALTH_CHECK.sql
```

- **شغّل كل مرحلة لوحدها** (حدّد البلوك → Run) — الملف فيه عدة استعلامات
- **مرحلة 3** تعرض **كل العيادات** (مو `LIMIT 1`)
- لعيادة واحدة: استخدم البلوك المعلّق `WHERE name_ar ILIKE '%الامل%'`

ترتيب SQL المالي إذا ظهر ❌:

```
09-payroll-accounting-complete.sql
fix-salary-month-closures.sql
37-salary-entry-doctor.sql          ← مو 36
38-freeze-doctor-share-on-payment.sql
18-fix-accounting-consistency.sql
21-fix-doctor-percentage-cast.sql
25-invoices-history.sql
26-invoices-history-doctor-expense.sql
```

---

## 3) سكربتات إضافية (حسب الميزة — مو كلها RLS)

شغّلها **فقط** إذا تستخدم الميزة وما شغّلت migration من قبل:

| # | الملف | ليش |
|---|--------|-----|
| 31 | `31-ready-for-billing.sql` | حالة «جاهز للمحاسبة» في الطابور |
| 32 | `32-visit-session-operation.sql` | ربط الطابور بالجلسة (`queue_entry_id`) |
| 38 | `38-freeze-doctor-share-on-payment.sql` | تجميد نسبة الطبيب عند الدفع |
| 39 | `39-queue-doctor-transfer-reject.sql` | رفض/تحويل من الطبيب في الانتظار |
| 40 | `40-push-subscriptions.sql` | تنبيهات موبايل الطبيب (PWA) |
| 41 | `41-operation-tooth-status.sql` | حالة/لون السن في مخطط الجلسة |
| 42 | `42-queue-cancellation-request.sql` | طلب إلغاء من الطبيب/المساعد |

---

## 4) ما تشغّله

- **`.env.local`** — على جهازك فقط، مو Supabase
- **نفس السكript أكثر من مرة** — OK بعد التصليحات (idempotent)
- **RLS منفصل** — مو مطلوب؛ موجود داخل APPLY_MULTI_TENANT_COMPLETE

---

## 5) بعد SQL

1. أعد تشغيل `npm run dev` (أو Vercel Redeploy)
2. من `/developer` جرّب إضافة عيادة ثانية
3. إذا حساب قديم بدون عيادة (نادر):  
   `SELECT public.link_profile_to_first_clinic();`

---

## 6) ملخص للمبتدئ

```
Supabase SQL Editor
    └── SCHEMA_HEALTH_CHECK.sql           ← فحص سريري/طابور
    └── FINANCIAL_HEALTH_CHECK.sql        ← فحص مالي (كل العيادات)
    └── APPLY_MULTI_TENANT_COMPLETE.sql   ← هذا كل شي للعزل
    └── 31–42                             ← إضافات حسب الحاجة (أو حسب ❌)
```

**GitHub / Vercel** = الكود. **Supabase SQL** = قاعدة البيانات. شغلتين منفصلتين.
