-- فحص إعداد إشعارات Push للأطباء
-- شغّل في Supabase SQL Editor
-- غيّر اسم الطبيب في السطر الأخير إن لزم

-- 1) هل جدول الاشتراكات موجود؟
SELECT
  CASE
    WHEN to_regclass('public.push_subscriptions') IS NOT NULL THEN 'OK — push_subscriptions exists'
    ELSE 'MISSING — run 40-push-subscriptions.sql'
  END AS push_table_status;

-- 2) ملخص الاشتراكات لكل عيادة
SELECT
  c.name_ar AS clinic_name,
  COUNT(ps.id) AS subscription_count,
  COUNT(DISTINCT ps.profile_id) AS doctors_with_device
FROM public.clinics c
LEFT JOIN public.push_subscriptions ps ON ps.clinic_id = c.id
GROUP BY c.id, c.name_ar
ORDER BY subscription_count DESC, c.name_ar;

-- 3) أطباء نشطون + ربط profile + عدد أجهزة Push
SELECT
  d.full_name_ar AS doctor_name,
  d.id AS doctor_id,
  d.profile_id,
  p.full_name AS login_name,
  p.role AS profile_role,
  CASE
    WHEN d.profile_id IS NULL THEN 'NOT LINKED'
    WHEN p.id IS NULL THEN 'BROKEN LINK'
    ELSE 'LINKED'
  END AS profile_link_status,
  COALESCE(sub.cnt, 0) AS push_devices,
  sub.last_push_at
FROM public.doctors d
LEFT JOIN public.profiles p ON p.id = d.profile_id
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::int AS cnt,
    MAX(ps.updated_at) AS last_push_at
  FROM public.push_subscriptions ps
  WHERE ps.profile_id = d.profile_id
) sub ON TRUE
WHERE d.is_active = TRUE
ORDER BY push_devices ASC, d.full_name_ar;

-- 4) تفاصيل اشتراكات طبيب معيّن (غيّر الاسم)
SELECT
  d.full_name_ar,
  ps.id,
  LEFT(ps.endpoint, 80) || '...' AS endpoint_preview,
  ps.user_agent,
  ps.updated_at
FROM public.doctors d
JOIN public.push_subscriptions ps ON ps.profile_id = d.profile_id
WHERE d.is_active = TRUE
  AND d.full_name_ar ILIKE '%'  -- ضع اسم الطبيب بين % %
ORDER BY ps.updated_at DESC;
