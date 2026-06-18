# استرجاع النظام بعد مشكلة — Master Clinic Plus

> **هذا ملف توثيق فقط.** ما يشغّل SQL ولا يغيّر التطبيق. اقرأه عند الطوارئ واتبع الخطوات يدوياً.

---

## قبل كل شي — افهم الفرق

| الجزء | وين يعيش | إذا خرب |
|-------|----------|---------|
| **التطبيق** (صفحات، APIs) | GitHub + Vercel | Rollback أو Redeploy |
| **قاعدة البيانات** (مرضى، حسابات، رواتب) | Supabase | Backup Restore أو إصلاح SQL محدود |

**Git = الكود. Supabase = البيانات.** ما تخلط بينهم.

---

## قاعدة ذهبية

1. **قبل أي سكript SQL على الإنتاج** → خذ نسخة احتياطية من Supabase.
2. **لا تشغّل كل ملفات `supabase/scripts/` دفعة واحدة** — هذا أكثر سبب للفوضى.
3. **البيانات المحذوفة** ترجع **فقط** من Backup — مو من إعادة تشغيل SQL.

---

## الخطوة 0 — حدّد نوع المشكلة (30 ثانية)

```
هل المرضى/الحسابات موجودة في Supabase Table Editor؟
  │
  ├─ نعم + التطبيق فقط معطّل     → القسم 1 (Vercel)
  ├─ نعم + خطأ column/enum/RLS   → القسم 2 (Health Check)
  ├─ لا / أرقام غلط / بيانات راحت → القسم 3 (Restore Backup)
  └─ مشروع Supabase انمسح بالكامل → القسم 4 (مشروع جديد)
```

---

## القسم 1 — التطبيق خرب، القاعدة سليمة

**أعراض:** صفحة بيضاء، 500، ميزة جديدة ما تشتغل — لكن البيانات في Supabase موجودة.

### ماذا تفعل

1. **Vercel** → Project → **Deployments**
2. اختر deployment **قبل** المشكلة → **Redeploy**
3. أو من GitHub: ارجع لـ commit سابق (`git revert` ثم push)

### ما تفعله

- لا تشغّل SQL «للتصليح» — المشكلة غالباً بالكود فقط.

---

## القسم 2 — خطأ SQL / عمود ناقص / RLS

**أعراض:** رسائل مثل `column does not exist`, `invalid input value for enum`, `access denied`, `PGRST205`.

### الخطوات (بالترتيب)

1. **لا تلمس البيانات** — لا DELETE ولا DROP TABLE.

2. شغّل **فحص الصحة** في Supabase → SQL Editor:

   ```
   supabase/scripts/SCHEMA_HEALTH_CHECK.sql
   ```

3. إذا في مشاكل مالية (محفظة، رواتب، فواتير):

   ```
   supabase/scripts/FINANCIAL_HEALTH_CHECK.sql
   ```

   - شغّل **كل مرحلة لوحدها** (حدّد البلوك → Run).

4. أي صف **❌ ناقص** → شغّل **فقط** الملف في عمود `fix_if_missing`.

5. أعد الفحص حتى كل الصفوف **✅ OK**.

6. **Vercel** → Redeploy (أو أعد `npm run dev` محلياً).

### ترتيب SQL العام

راجع: [`supabase/scripts/README-SQL-ORDER.md`](../supabase/scripts/README-SQL-ORDER.md)

### سكriptات شائعة (حسب الميزة)

| الميزة | الملف |
|--------|--------|
| عزل العيادات (مرة واحدة) | `APPLY_MULTI_TENANT_COMPLETE.sql` |
| مساعد أجر يومي | `30-assistant-daily-wage.sql` |
| نسبة الطبيب 0–100 | `29-doctor-percentage-0-100-full.sql` |
| رواتب مساعدين | `06-assistant-payroll-records.sql`, `09-payroll-accounting-complete.sql` |

---

## القسم 3 — بيانات انحذفت أو انخلطت

**أعراض:** مرضى راحوا، أرقام محفظة غلط، عيادة تشوف بيانات عيادة ثانية.

### ماذا تفعل أولاً

1. **أوقف** تشغيل أي سكript SQL جديد.
2. **Supabase Dashboard** → **Database** → **Backups**
3. **Restore** إلى وقت **قبل** المشكلة (Point-in-Time إن متوفر).

### إذا ما عندك Backup

- الاسترجاع الكامل للبيانات **غير ممكن** من Git أو من SQL.
- يبقى: إعادة إدخال يدوي أو export قديم إن وُجد.

### بعد Restore

1. تحقق من Table Editor (مرضى، عيادات، profiles).
2. شغّل `SCHEMA_HEALTH_CHECK.sql` للتأكد من البنية.
3. Redeploy على Vercel.

---

## القسم 4 — مشروع Supabase جديد (كارثة كاملة)

**استخدم هذا فقط** إذا المشروع انمسح أو تريد بداية schema نظيفة **بدون** بيانات قديمة.

### ترتيب الإعداد

1. أنشئ مشروع Supabase جديد.
2. حدّث `.env.local` و **Vercel Environment Variables**:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. SQL Editor — بالترتيب:
   - `supabase/scripts/APPLY_MULTI_TENANT_COMPLETE.sql`
   - `supabase/scripts/SCHEMA_HEALTH_CHECK.sql` → أصلح ❌
   - `supabase/scripts/FINANCIAL_HEALTH_CHECK.sql` → أصلح ❌
   - سكriptات الميزات التي تستخدمها (راجع README-SQL-ORDER)
4. من `/developer` → أضف العيادات والمالكين من جديد.
5. Vercel → Redeploy.

---

## قائمة تحقق — وقاية (مرة بالأسبوع أو قبل SQL كبير)

- [ ] تأكد أن **Backups** مفعّلة في Supabase (Settings → Database)
- [ ] قبل سكript جديد: **Backup** أو على الأقل Export للجداول الحساسة
- [ ] سجّل في ورقة: «تاريخ X — شغّلت ملف Y — السبب Z»
- [ ] جرّب SQL **الخطير** على مشروع Supabase **تجريبي** أولاً
- [ ] احفظ نسخة من `.env.local` / مفاتيح Vercel في مكان آمن (مو Git)

---

## جدول قرارات سريع

| الأعراض | الحل | لا تسوي |
|---------|------|---------|
| التطبيق ما يفتح بعد deploy | Vercel rollback | تشغيل 100 سكript |
| `column X does not exist` | SCHEMA_HEALTH_CHECK → ملف fix واحد | DROP TABLE |
| بيانات ناقصة | Restore backup | إعادة APPLY_MULTI_TENANT على بيانات حية |
| عيادة جديدة فاضية | طبيعي — أضف بيانات | link_profile_to_first_clinic على إنتاج |
| enum / daily_wage | `30-assistant-daily-wage.sql` | حذف جداول |

---

## روابط مفيدة داخل المشروع

| الملف | الغرض |
|-------|--------|
| [`supabase/scripts/README-SQL-ORDER.md`](../supabase/scripts/README-SQL-ORDER.md) | ترتيب تشغيل SQL |
| [`supabase/scripts/SCHEMA_HEALTH_CHECK.sql`](../supabase/scripts/SCHEMA_HEALTH_CHECK.sql) | فحص الجداول والأعمدة |
| [`supabase/scripts/FINANCIAL_HEALTH_CHECK.sql`](../supabase/scripts/FINANCIAL_HEALTH_CHECK.sql) | فحص المحاسبة |
| [`docs/MULTI_TENANT.md`](MULTI_TENANT.md) | عزل العيادات |
| [`docs/VERCEL_DEPLOY.md`](VERCEL_DEPLOY.md) | النشر ومتغيرات البيئة |

---

## Supabase Dashboard — أين تجد الأشياء

| المطلوب | المسار |
|---------|--------|
| SQL Editor | Project → SQL Editor |
| نسخ احتياطي / استرجاع | Project Settings → Database → Backups |
| جداول البيانات | Table Editor |
| مفاتيح API | Project Settings → API |
| سجلات الأخطاء | Logs → Postgres / API |

---

## ملاحظة أخيرة

هذا الدليل **يوجّهك** — ما يستبدل النسخ الاحتياطي.  
أهم خطوة واحدة: **Backup قبل SQL، Restore عند كارثة البيانات.**
