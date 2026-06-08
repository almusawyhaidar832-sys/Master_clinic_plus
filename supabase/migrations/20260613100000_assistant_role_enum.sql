-- إضافة قيمة assistant — يجب أن يكون هذا الملف بمفرده (بدون استعلامات تستخدم user_role)

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'assistant';
