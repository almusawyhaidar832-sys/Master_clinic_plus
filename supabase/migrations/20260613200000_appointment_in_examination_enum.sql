-- سطر واحد — شغّله منفصلاً في SQL Editor إذا دمجته مع ملفات أخرى وفشل enum

ALTER TYPE public.appointment_status ADD VALUE IF NOT EXISTS 'in_examination';
