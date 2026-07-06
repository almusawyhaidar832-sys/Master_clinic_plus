-- السماح للمحاسب/المالك بحجز موعد على وقت محجوز مسبقاً
--
-- قيد appointments_no_doctor_overlap كان يمنع أي تداخل لنفس الطبيب (ما عدا الملغى).
-- الحجز العام يبقى بحالة pending — نُقيّد القيد على pending فقط لمنع الحجز المزدوج
-- من صفحة الباركود/الإنترنت، بينما مواعيد الموظفين (confirmed وغيرها) يمكن تكرارها.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- tsrange(date+time) داخل القيد يفشل على Supabase (42P17) — نلفّه بدالة IMMUTABLE
CREATE OR REPLACE FUNCTION public.appointment_slot_tsrange(
  p_date date,
  p_start time,
  p_end time
)
RETURNS tsrange
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT tsrange(
    p_date + p_start,
    GREATEST(p_date + p_end, p_date + p_start + interval '1 minute'),
    '[)'
  );
$$;

-- بعض قواعد البيانات تخزّن appointment_date كـ timestamptz بدل date
CREATE OR REPLACE FUNCTION public.appointment_slot_tsrange(
  p_date timestamptz,
  p_start time,
  p_end time
)
RETURNS tsrange
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT tsrange(
    d + p_start,
    GREATEST(d + p_end, d + p_start + interval '1 minute'),
    '[)'
  )
  FROM (SELECT (timezone('UTC', p_date))::date AS d) s;
$$;

-- إصلاح بيانات تالفة تمنع بناء القيد (نهاية ≤ بداية أو أوقات فارغة)
UPDATE public.appointments
SET
  start_time = COALESCE(start_time, '09:00:00'::time),
  end_time = CASE
    WHEN end_time IS NULL
      OR end_time <= COALESCE(start_time, '09:00:00'::time)
    THEN (COALESCE(start_time, '09:00:00'::time) + interval '30 minutes')::time
    ELSE end_time
  END
WHERE status = 'pending'
  AND (
    start_time IS NULL
    OR end_time IS NULL
    OR end_time <= start_time
  );

ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_no_doctor_overlap;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_no_doctor_overlap
  EXCLUDE USING gist (
    doctor_id WITH =,
    public.appointment_slot_tsrange(appointment_date, start_time, end_time) WITH &&
  )
  WHERE (status = 'pending');

NOTIFY pgrst, 'reload schema';
