-- =============================================================================
-- إصلاح Multi-tenant RLS — ملف واحد مكتفي بذاته
-- شغّله في Supabase SQL Editor إذا فشل السكربت الكبير أو ظهر:
--   • function is_platform_admin() does not exist
--   • there is no parameter $1
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1) إعدادات المنصة + بريد المدير العام
CREATE TABLE IF NOT EXISTS public.platform_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.platform_settings (key, value)
VALUES ('admin_email', 'almusawyhaidar832@gmail.com')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, updated_at = NOW();

-- 2) أعمدة clinics (إن وُجد الجدول)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'clinics'
  ) THEN
    ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS whatsapp_instance_name TEXT;
    ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS whatsapp_api_key TEXT;
    ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS owner_email TEXT;
  END IF;
END $$;

-- 3) الدوال المطلوبة — يجب إنشاؤها قبل السياسات
CREATE OR REPLACE FUNCTION public.get_platform_admin_email()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT lower(trim(value))
  FROM public.platform_settings
  WHERE key = 'admin_email'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM auth.users u
      WHERE u.id = auth.uid()
        AND lower(trim(coalesce(u.email, ''))) = coalesce(public.get_platform_admin_email(), '')
    );
$$;

CREATE OR REPLACE FUNCTION public.get_my_clinic_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT clinic_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS public.user_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.tenant_can_access(p_clinic_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_admin()
    OR (
      p_clinic_id IS NOT NULL
      AND p_clinic_id = public.get_my_clinic_id()
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_admin_email() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_clinic_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_can_access(UUID) TO authenticated;

-- 4) دالة تطبيق RLS (بدون $1)
CREATE OR REPLACE FUNCTION public.apply_tenant_rls(
  p_table TEXT,
  p_mutate_roles TEXT[] DEFAULT ARRAY['accountant', 'super_admin']
)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  roles_list TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = p_table
  ) THEN
    RAISE NOTICE 'تخطي جدول غير موجود: %', p_table;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = p_table
      AND column_name = 'clinic_id'
  ) THEN
    RAISE NOTICE 'تخطي % — لا يوجد clinic_id', p_table;
    RETURN;
  END IF;

  SELECT string_agg(quote_literal(r), ', ')
  INTO roles_list
  FROM unnest(COALESCE(p_mutate_roles, ARRAY['accountant', 'super_admin']::text[])) AS u(r);

  IF roles_list IS NULL THEN
    roles_list := quote_literal('accountant') || ', ' || quote_literal('super_admin');
  END IF;

  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_table);

  EXECUTE format(
    'DROP POLICY IF EXISTS %I_select ON public.%I',
    p_table || '_tenant',
    p_table
  );
  EXECUTE format(
    'DROP POLICY IF EXISTS %I_mutate ON public.%I',
    p_table || '_tenant',
    p_table
  );
  EXECUTE format('DROP POLICY IF EXISTS %I_all ON public.%I', p_table, p_table);

  EXECUTE format(
    'CREATE POLICY %I_select ON public.%I FOR SELECT TO authenticated
     USING (public.tenant_can_access(clinic_id))',
    p_table || '_tenant',
    p_table
  );

  EXECUTE format(
    'CREATE POLICY %I_mutate ON public.%I FOR ALL TO authenticated
     USING (
       public.tenant_can_access(clinic_id)
       AND (
         public.is_platform_admin()
         OR public.get_my_role()::text = ANY(ARRAY[%s]::text[])
       )
     )
     WITH CHECK (
       public.tenant_can_access(clinic_id)
       AND (
         public.is_platform_admin()
         OR public.get_my_role()::text = ANY(ARRAY[%s]::text[])
       )
     )',
    p_table || '_tenant',
    p_table,
    roles_list,
    roles_list
  );

  RAISE NOTICE '✓ RLS applied: %', p_table;
END;
$$;

-- 5) تطبيق على كل الجداول
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'operation_types', 'doctors', 'patients', 'patient_operations',
    'treatments', 'medical_logs', 'appointments', 'schedule_locks',
    'expenses', 'staff_members', 'salary_entries', 'salary_slips',
    'salary_month_closures', 'clinic_settings', 'expense_categories',
    'patient_queue', 'operation_xray_images', 'operation_tooth_records',
    'patient_treatment_plans', 'patient_treatment_cases', 'activity_logs',
    'whatsapp_messages'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    PERFORM public.apply_tenant_rls(t);
  END LOOP;
END $$;

-- مساعد: هل الجدول موجود؟
CREATE OR REPLACE FUNCTION public._table_exists(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = p_name
  );
$$;

-- 6) سياسات clinics + profiles (إن وُجدت)
DO $$
BEGIN
  IF public._table_exists('clinics') THEN
    ALTER TABLE public.clinics ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS super_admin_all_clinics ON public.clinics;
    DROP POLICY IF EXISTS clinic_tenant_select ON public.clinics;
    DROP POLICY IF EXISTS clinic_tenant_update ON public.clinics;
    DROP POLICY IF EXISTS clinics_platform_select ON public.clinics;
    DROP POLICY IF EXISTS clinics_platform_insert ON public.clinics;
    DROP POLICY IF EXISTS clinics_platform_update ON public.clinics;
    DROP POLICY IF EXISTS clinics_platform_delete ON public.clinics;

    CREATE POLICY clinics_platform_select ON public.clinics
      FOR SELECT TO authenticated
      USING (public.is_platform_admin() OR id = public.get_my_clinic_id());

    CREATE POLICY clinics_platform_insert ON public.clinics
      FOR INSERT TO authenticated
      WITH CHECK (public.is_platform_admin());

    CREATE POLICY clinics_platform_update ON public.clinics
      FOR UPDATE TO authenticated
      USING (public.is_platform_admin() OR id = public.get_my_clinic_id())
      WITH CHECK (public.is_platform_admin() OR id = public.get_my_clinic_id());

    CREATE POLICY clinics_platform_delete ON public.clinics
      FOR DELETE TO authenticated
      USING (public.is_platform_admin());
  ELSE
    RAISE NOTICE 'تخطي clinics — الجدول غير موجود';
  END IF;

  IF public._table_exists('profiles') THEN
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS profiles_select ON public.profiles;
    DROP POLICY IF EXISTS profiles_update_self ON public.profiles;

    CREATE POLICY profiles_select ON public.profiles
      FOR SELECT TO authenticated
      USING (
        public.is_platform_admin()
        OR id = auth.uid()
        OR (
          clinic_id = public.get_my_clinic_id()
          AND public.get_my_role() IN ('super_admin', 'accountant')
          AND (public.get_my_role() = 'super_admin' OR role <> 'super_admin')
        )
      );

    CREATE POLICY profiles_update_self ON public.profiles
      FOR UPDATE TO authenticated
      USING (public.is_platform_admin() OR id = auth.uid());
  ELSE
    RAISE NOTICE 'تخطي profiles — الجدول غير موجود';
  END IF;
END $$;

-- 7) سياسات إضافية — فقط للجداول الموجودة فعلاً
CREATE OR REPLACE FUNCTION public._apply_simple_tenant_all(p_table TEXT)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT public._table_exists(p_table) THEN
    RAISE NOTICE 'تخطي (غير موجود): %', p_table;
    RETURN;
  END IF;
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('DROP POLICY IF EXISTS %I_all ON public.%I', p_table, p_table);
  EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON public.%I', p_table, p_table);
  EXECUTE format(
    'CREATE POLICY %I_tenant ON public.%I FOR ALL TO authenticated
     USING (public.tenant_can_access(clinic_id))
     WITH CHECK (public.tenant_can_access(clinic_id))',
    p_table, p_table
  );
  RAISE NOTICE '✓ simple tenant policy: %', p_table;
END;
$$;

DO $$
BEGIN
  IF public._table_exists('patients') THEN
    ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS patients_all ON public.patients;
    DROP POLICY IF EXISTS patients_tenant_select ON public.patients;
    DROP POLICY IF EXISTS patients_tenant_mutate ON public.patients;
    DROP POLICY IF EXISTS patients_tenant ON public.patients;

    CREATE POLICY patients_tenant_select ON public.patients
      FOR SELECT TO authenticated
      USING (public.tenant_can_access(clinic_id));

    CREATE POLICY patients_tenant_mutate ON public.patients
      FOR ALL TO authenticated
      USING (
        public.tenant_can_access(clinic_id)
        AND (
          public.is_platform_admin()
          OR public.get_my_role() IN ('accountant', 'super_admin', 'doctor')
        )
      )
      WITH CHECK (public.tenant_can_access(clinic_id));
  END IF;

  PERFORM public._apply_simple_tenant_all('patient_operations');
  PERFORM public._apply_simple_tenant_all('treatments');
  PERFORM public._apply_simple_tenant_all('medical_logs');
  PERFORM public._apply_simple_tenant_all('appointments');
  PERFORM public._apply_simple_tenant_all('schedule_locks');

  IF public._table_exists('doctor_withdrawals') THEN
    ALTER TABLE public.doctor_withdrawals ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS withdrawals_select ON public.doctor_withdrawals;
    DROP POLICY IF EXISTS withdrawals_doctor_insert ON public.doctor_withdrawals;
    DROP POLICY IF EXISTS withdrawals_accountant_update ON public.doctor_withdrawals;
    DROP POLICY IF EXISTS doctor_withdrawals_tenant_select ON public.doctor_withdrawals;
    DROP POLICY IF EXISTS doctor_withdrawals_tenant_mutate ON public.doctor_withdrawals;
    DROP POLICY IF EXISTS doctor_withdrawals_insert ON public.doctor_withdrawals;
    DROP POLICY IF EXISTS doctor_withdrawals_update ON public.doctor_withdrawals;

    CREATE POLICY doctor_withdrawals_tenant_select ON public.doctor_withdrawals
      FOR SELECT TO authenticated
      USING (public.tenant_can_access(clinic_id));

    CREATE POLICY doctor_withdrawals_insert ON public.doctor_withdrawals
      FOR INSERT TO authenticated
      WITH CHECK (
        public.tenant_can_access(clinic_id)
        AND (
          public.is_platform_admin()
          OR public.get_my_role() IN ('accountant', 'super_admin')
          OR doctor_id IN (SELECT id FROM public.doctors WHERE profile_id = auth.uid())
        )
      );

    CREATE POLICY doctor_withdrawals_update ON public.doctor_withdrawals
      FOR UPDATE TO authenticated
      USING (
        public.tenant_can_access(clinic_id)
        AND (
          public.is_platform_admin()
          OR public.get_my_role() IN ('accountant', 'super_admin')
        )
      )
      WITH CHECK (public.tenant_can_access(clinic_id));
  END IF;

  IF public._table_exists('notifications') THEN
    ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS notifications_own ON public.notifications;
    DROP POLICY IF EXISTS notifications_tenant ON public.notifications;

    CREATE POLICY notifications_tenant ON public.notifications
      FOR ALL TO authenticated
      USING (
        public.is_platform_admin()
        OR (
          recipient_profile_id = auth.uid()
          AND public.tenant_can_access(clinic_id)
        )
      )
      WITH CHECK (
        public.is_platform_admin()
        OR (
          recipient_profile_id = auth.uid()
          AND public.tenant_can_access(clinic_id)
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  RAISE NOTICE '✓ fix-apply-tenant-rls.sql اكتمل بنجاح';
END $$;
