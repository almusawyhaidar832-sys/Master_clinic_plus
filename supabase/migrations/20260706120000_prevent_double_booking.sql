-- منع الحجز المزدوج (Double Booking) بقيد قاعدة بيانات حقيقي
--
-- المشكلة: فحص التعارض بالحجوزات (عام/مساعد/محاسب) كان مجرد
-- "SELECT ثم قارن بالكود ثم INSERT/UPDATE" بدون أي قفل — حجزان متزامنان
-- لنفس الطبيب/الوقت (طلبان من صفحة الحجز العام مثلاً) يقدران يمران كلاهما
-- من نفس فحص SELECT قبل أن يُدرج أي منهما صفه.
--
-- الإصلاح: قيد EXCLUDE حقيقي بقاعدة البيانات يمنع تداخل فترتي زمن لنفس
-- الطبيب في جدول appointments — يبقى فحص SELECT بالتطبيق (تجربة استخدام
-- أسرع/رسالة فورية) لكنه لم يعد خط الدفاع الوحيد.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ملاحظة: إذا فشل هذا الـ migration بخطأ "conflicting key value" فهذا يعني
-- وجود بيانات تاريخية متعارضة فعلاً (نتيجة نفس الثغرة قبل الإصلاح) — يجب
-- حلّها يدوياً (إلغاء أحد الموعدين المتعارضين أو تعديل وقته) قبل إعادة
-- تشغيل هذا الملف.
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_no_doctor_overlap
  EXCLUDE USING gist (
    doctor_id WITH =,
    tsrange(
      (appointment_date + start_time)::timestamp,
      (appointment_date + end_time)::timestamp,
      '[)'
    ) WITH &&
  )
  WHERE (status <> 'cancelled');

NOTIFY pgrst, 'reload schema';
