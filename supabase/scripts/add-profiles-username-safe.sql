-- إضافة عمود username لجدول profiles — آمن للتشغيل أكثر من مرة
-- شغّل في Supabase SQL Editor

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_lower
  ON public.profiles (lower(username))
  WHERE username IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_email_for_username(p_username text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT u.email::text
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE lower(trim(p.username)) = lower(trim(p_username))
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_email_for_username(text) TO anon, authenticated;

-- السياسات أدناه فقط إن لم تكن موجودة (تخطي الخطأ إن وُجدت)
DO $$ BEGIN
  CREATE POLICY profiles_insert_self ON public.profiles FOR INSERT
    WITH CHECK (id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY profiles_update_self ON public.profiles FOR UPDATE
    USING (id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
