-- تحقق اختياري — شغّله في Run منفصل بعد نجاح 01-add-assistant-role-enum.sql

SELECT unnest(enum_range(NULL::public.user_role)) AS user_role_values;
