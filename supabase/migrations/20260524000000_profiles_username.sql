-- Username-based login (instead of exposing email in UI)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_lower
  ON public.profiles (lower(username))
  WHERE username IS NOT NULL;

-- Resolve auth email from username for sign-in
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

-- Allow new users to create their profile after sign-up
CREATE POLICY profiles_insert_self ON public.profiles FOR INSERT
  WITH CHECK (id = auth.uid());

CREATE POLICY profiles_update_self ON public.profiles FOR UPDATE
  USING (id = auth.uid());
