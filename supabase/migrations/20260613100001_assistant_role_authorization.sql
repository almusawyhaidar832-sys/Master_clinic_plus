-- الخطوة 2 من 2 — ربط المساعد + RLS + create_user_profile
-- يتطلب تشغيل 20260613100000_assistant_role_enum.sql أولاً

-- 1) Link assistants to auth profiles
ALTER TABLE public.assistants
  ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_assistants_profile_id
  ON public.assistants(profile_id)
  WHERE profile_id IS NOT NULL;

COMMENT ON COLUMN public.assistants.profile_id IS
  'ربط حساب الدخول (profiles) بسجل المساعد';

-- 2) Helpers for assistant-scoped queries
CREATE OR REPLACE FUNCTION public.get_my_assistant_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id
  FROM public.assistants
  WHERE profile_id = auth.uid()
    AND is_active = TRUE
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_my_assistant_doctor_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT doctor_id
  FROM public.assistants
  WHERE profile_id = auth.uid()
    AND is_active = TRUE
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_assistant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_assistant_doctor_id() TO authenticated;

-- 3) Appointments RLS — المساعد يرى مواعيد طبيبه فقط
DROP POLICY IF EXISTS appointments_tenant_select ON public.appointments;
DROP POLICY IF EXISTS appointments_tenant_mutate ON public.appointments;
DROP POLICY IF EXISTS appointments_all ON public.appointments;
DROP POLICY IF EXISTS appointments_tenant ON public.appointments;

CREATE POLICY appointments_tenant_select ON public.appointments
  FOR SELECT TO authenticated
  USING (
    public.tenant_can_access(clinic_id)
    AND (
      public.get_my_role() IS DISTINCT FROM 'assistant'::public.user_role
      OR doctor_id = public.get_my_assistant_doctor_id()
    )
  );

CREATE POLICY appointments_tenant_mutate ON public.appointments
  FOR ALL TO authenticated
  USING (
    public.tenant_can_access(clinic_id)
    AND (
      public.is_platform_admin()
      OR public.get_my_role() IN ('accountant', 'super_admin', 'doctor')
      OR (
        public.get_my_role() = 'assistant'::public.user_role
        AND doctor_id = public.get_my_assistant_doctor_id()
      )
    )
  )
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND (
      public.is_platform_admin()
      OR public.get_my_role() IN ('accountant', 'super_admin', 'doctor')
      OR (
        public.get_my_role() = 'assistant'::public.user_role
        AND doctor_id = public.get_my_assistant_doctor_id()
      )
    )
  );

-- 4) Assistants RLS — المساعد يرى سجله فقط
DROP POLICY IF EXISTS assistants_tenant_select ON public.assistants;
DROP POLICY IF EXISTS assistants_tenant_mutate ON public.assistants;

CREATE POLICY assistants_tenant_select ON public.assistants
  FOR SELECT TO authenticated
  USING (
    public.tenant_can_access(clinic_id)
    AND (
      public.get_my_role() IS DISTINCT FROM 'assistant'::public.user_role
      OR profile_id = auth.uid()
    )
  );

CREATE POLICY assistants_tenant_mutate ON public.assistants
  FOR ALL TO authenticated
  USING (
    public.tenant_can_access(clinic_id)
    AND (
      public.is_platform_admin()
      OR public.get_my_role() IN ('accountant', 'super_admin')
    )
  )
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND (
      public.is_platform_admin()
      OR public.get_my_role() IN ('accountant', 'super_admin')
    )
  );

-- 5) create_user_profile — المحاسب يُنشئ مساعدين أيضاً
CREATE OR REPLACE FUNCTION public.create_user_profile(
  p_user_id    UUID,
  p_clinic_id  UUID,
  p_role       public.user_role,
  p_full_name  TEXT,
  p_username   TEXT,
  p_phone      TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role       public.user_role;
  v_caller_clinic_id  UUID;
BEGIN
  SELECT role, clinic_id
    INTO v_caller_role, v_caller_clinic_id
    FROM public.profiles
   WHERE id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNAUTHORIZED: caller has no profile';
  END IF;

  IF v_caller_role NOT IN ('super_admin', 'accountant') THEN
    RAISE EXCEPTION 'FORBIDDEN: insufficient role (got %)', v_caller_role;
  END IF;

  IF v_caller_role = 'super_admin' AND p_role <> 'accountant' THEN
    RAISE EXCEPTION 'FORBIDDEN: super_admin can only create accountant accounts';
  END IF;

  IF v_caller_role = 'accountant' AND p_role NOT IN ('doctor', 'assistant') THEN
    RAISE EXCEPTION 'FORBIDDEN: accountant can only create doctor or assistant accounts';
  END IF;

  IF v_caller_clinic_id IS NOT NULL AND p_clinic_id <> v_caller_clinic_id THEN
    RAISE EXCEPTION 'FORBIDDEN: cannot create user for a different clinic';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE username = p_username) THEN
    RAISE EXCEPTION 'CONFLICT: username already taken';
  END IF;

  INSERT INTO public.profiles (
    id, clinic_id, role, full_name, username, phone, is_active
  ) VALUES (
    p_user_id, p_clinic_id, p_role, p_full_name, p_username, p_phone, TRUE
  );

  IF p_role = 'doctor' THEN
    INSERT INTO public.doctors (
      clinic_id, profile_id, full_name_ar,
      percentage, materials_share, is_active
    ) VALUES (
      p_clinic_id, p_user_id, p_full_name,
      '50', '0', TRUE
    );
  END IF;
END;
$$;
