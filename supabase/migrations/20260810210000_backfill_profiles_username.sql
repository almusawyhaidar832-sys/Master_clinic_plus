-- تعبئة profiles.username للحسابات القديمة التي أُنشئت ببريد مباشر بدون username.
-- هذه الحسابات لا تستطيع الدخول باسم المستخدم: get_email_for_username يطابق على
-- p.username فقط، وعند فشله يرجع التطبيق إلى النمط username@masterclinic.local
-- الذي لا يطابق البريد الحقيقي.
--
-- مثال واقعي: مدير عيادة الأمل — البريد ali123@gmail.com و username = NULL.

WITH candidates AS (
  SELECT
    p.id,
    regexp_replace(lower(split_part(u.email, '@', 1)), '[^a-z0-9._-]', '', 'g')
      AS candidate
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.username IS NULL
    AND u.email IS NOT NULL
),
assignable AS (
  SELECT
    id,
    candidate,
    row_number() OVER (PARTITION BY candidate ORDER BY id) AS rn
  FROM candidates
  WHERE length(candidate) BETWEEN 3 AND 32
    -- الفهرس الفريد على lower(username) يرفض أي تعارض
    AND NOT EXISTS (
      SELECT 1
      FROM public.profiles taken
      WHERE lower(trim(taken.username)) = candidate
    )
)
UPDATE public.profiles p
SET username = a.candidate
FROM assignable a
WHERE p.id = a.id
  AND a.rn = 1;
