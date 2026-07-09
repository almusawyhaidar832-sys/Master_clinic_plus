-- تشخيص فقط (بدون أي تعديل) — لإيجاد أي Trigger على جدول transactions
-- يُصفّر clinic_id قبل الإدراج. أثبتنا بإدراج تجريبي مباشر أن الصف الفعلي
-- يصل لقيد NOT NULL بـ clinic_id = NULL حتى مع تمرير قيمة صحيحة — إذن
-- المسؤول Trigger غير موجود بأي ملف SQL بالمشروع (أُنشئ يدوياً في وقت ما).

select
  t.tgname as trigger_name,
  pg_get_triggerdef(t.oid) as trigger_definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
where c.relname = 'transactions'
  and not t.tgisinternal;

-- تعريف كل الدوال المستخدمة بأي Trigger على transactions (إن وُجدت أعلاه)
select
  p.proname as function_name,
  pg_get_functiondef(p.oid) as function_definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_proc p on p.oid = t.tgfoid
where c.relname = 'transactions'
  and not t.tgisinternal;
