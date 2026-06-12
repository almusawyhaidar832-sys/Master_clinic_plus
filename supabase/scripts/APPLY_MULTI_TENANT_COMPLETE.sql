-- =============================================================================
-- Master Clinic Plus — Multi-Tenant (دفعة واحدة في Supabase SQL Editor)
-- =============================================================================
-- يشمل:
--   • توسيع جدول clinics (instance, api key, owner_email, is_active)
--   • التأكد من clinic_id + RLS + Triggers لكل الجداول التشغيلية
--   • المدير العام (بريد المنصة) يرى كل العيادات عبر is_platform_admin()
--
-- آمن للتشغيل أكثر من مرة (IF NOT EXISTS / DROP POLICY IF EXISTS)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- 1) إعدادات المنصة — بريد المدير العام (غيّر القيمة هنا إن لزم)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.platform_settings (key, value)
VALUES ('admin_email', 'almusawyhaidar832@gmail.com')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, updated_at = NOW();

-- -----------------------------------------------------------------------------
-- 2) جدول العيادات (clinics) — أعمدة Multi-tenant + واتساب
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clinics (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- أعمدة إضافية (متوافقة مع التطبيق الحالي)
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS name_ar TEXT;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS whatsapp_linked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS whatsapp_session_id TEXT;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- الأعمدة المطلوبة في المواصفة الجديدة
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS whatsapp_instance_name TEXT;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS whatsapp_api_key TEXT;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS owner_email TEXT;

-- مزامنة الأسماء القديمة → الجديدة
UPDATE public.clinics
SET whatsapp_instance_name = COALESCE(whatsapp_instance_name, whatsapp_session_id)
WHERE whatsapp_instance_name IS NULL AND whatsapp_session_id IS NOT NULL;

UPDATE public.clinics
SET whatsapp_session_id = COALESCE(whatsapp_session_id, whatsapp_instance_name)
WHERE whatsapp_session_id IS NULL AND whatsapp_instance_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clinics_is_active ON public.clinics (is_active);
CREATE INDEX IF NOT EXISTS idx_clinics_owner_email ON public.clinics (lower(owner_email))
  WHERE owner_email IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3) دوال المساعدة — المدير العام + العيادة الحالية
-- -----------------------------------------------------------------------------
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

COMMENT ON FUNCTION public.is_platform_admin IS
  'المدير العام للمنصة — يطابق بريد auth.users مع platform_settings.admin_email';

COMMENT ON FUNCTION public.tenant_can_access IS
  'Multi-tenant: المدير العام أو نفس clinic_id للمستخدم';

-- سياسات platform_settings (بعد تعريف is_platform_admin)
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_settings_read ON public.platform_settings;
CREATE POLICY platform_settings_read ON public.platform_settings
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS platform_settings_write ON public.platform_settings;
CREATE POLICY platform_settings_write ON public.platform_settings
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- -----------------------------------------------------------------------------
-- 4) تعيين clinic_id تلقائياً عند INSERT
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_clinic_id_from_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_my_clinic UUID;
BEGIN
  v_my_clinic := public.get_my_clinic_id();

  IF NEW.clinic_id IS NULL THEN
    IF public.is_platform_admin() AND v_my_clinic IS NOT NULL THEN
      NEW.clinic_id := v_my_clinic;
    ELSIF public.is_platform_admin() THEN
      RAISE EXCEPTION 'clinic_id مطلوب — المدير العام يجب تحديد العيادة صراحة';
    ELSIF v_my_clinic IS NULL THEN
      RAISE EXCEPTION 'لا توجد عيادة مربوطة بالحساب — نفّذ link_profile_to_first_clinic أو اربط clinic_id';
    ELSE
      NEW.clinic_id := v_my_clinic;
    END IF;
  ELSIF NOT public.is_platform_admin()
        AND v_my_clinic IS NOT NULL
        AND NEW.clinic_id IS DISTINCT FROM v_my_clinic THEN
    RAISE EXCEPTION 'لا يمكنك إدراج بيانات لعيادة أخرى (tenant isolation)';
  END IF;

  RETURN NEW;
END;
$$;

-- ربط الـ Trigger بكل جدول يحتوي clinic_id (ما عدا clinics و profiles)
DO $$
DECLARE
  r RECORD;
  trg_name TEXT := 'trg_auto_clinic_id';
BEGIN
  FOR r IN
    SELECT c.relname AS tbl
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname NOT IN ('clinics', 'profiles', 'platform_settings')
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.oid
          AND a.attname = 'clinic_id'
          AND NOT a.attisdropped
      )
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trg_name, r.tbl);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.set_clinic_id_from_profile()',
      trg_name, r.tbl
    );
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 5) إضافة clinic_id لأي جدول ناقص (إن وُجد بدون العمود)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  first_clinic UUID;
BEGIN
  SELECT id INTO first_clinic FROM public.clinics ORDER BY created_at LIMIT 1;

  FOR r IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name NOT IN ('clinics', 'profiles', 'platform_settings')
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = r.table_name
        AND column_name = 'clinic_id'
    ) THEN
      -- فقط للجداول التشغيلية المعروفة بدون clinic_id
      IF r.table_name IN ('schema_migrations') THEN
        CONTINUE;
      END IF;
      -- activity_logs لديها clinic_id اختياري — تُضاف إن غابت
      IF r.table_name = 'activity_logs' THEN
        EXECUTE 'ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id) ON DELETE CASCADE';
        IF first_clinic IS NOT NULL THEN
          EXECUTE 'UPDATE public.activity_logs SET clinic_id = $1 WHERE clinic_id IS NULL' USING first_clinic;
        END IF;
      END IF;
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 6) RLS — إعادة سياسات العزل الموحّدة
-- -----------------------------------------------------------------------------
ALTER TABLE public.clinics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS super_admin_all_clinics ON public.clinics;
DROP POLICY IF EXISTS clinic_tenant_select ON public.clinics;
DROP POLICY IF EXISTS clinic_tenant_update ON public.clinics;
DROP POLICY IF EXISTS clinics_platform_select ON public.clinics;
DROP POLICY IF EXISTS clinics_platform_mutate ON public.clinics;
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

-- profiles
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

-- دالة تطبيق RLS موحّد على جدول له clinic_id
CREATE OR REPLACE FUNCTION public.apply_tenant_rls(
  p_table TEXT,
  p_mutate_roles TEXT[] DEFAULT ARRAY['accountant', 'super_admin']
)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  roles_list TEXT;
BEGIN
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
END;
$$;

-- جداول tenant — SELECT للجميع المصرح، INSERT/UPDATE/DELETE للمحاسب والمالك
SELECT public.apply_tenant_rls('operation_types');
SELECT public.apply_tenant_rls('doctors');
SELECT public.apply_tenant_rls('patients');
SELECT public.apply_tenant_rls('patient_operations');
SELECT public.apply_tenant_rls('treatments');
SELECT public.apply_tenant_rls('medical_logs');
SELECT public.apply_tenant_rls('appointments');
SELECT public.apply_tenant_rls('schedule_locks');
SELECT public.apply_tenant_rls('expenses');
SELECT public.apply_tenant_rls('staff_members');
SELECT public.apply_tenant_rls('salary_entries');
SELECT public.apply_tenant_rls('salary_slips');
SELECT public.apply_tenant_rls('salary_month_closures');
SELECT public.apply_tenant_rls('clinic_settings');
SELECT public.apply_tenant_rls('expense_categories');
SELECT public.apply_tenant_rls('patient_queue');
SELECT public.apply_tenant_rls('operation_xray_images');
SELECT public.apply_tenant_rls('operation_tooth_records');
SELECT public.apply_tenant_rls('patient_treatment_plans');
SELECT public.apply_tenant_rls('patient_treatment_cases');
SELECT public.apply_tenant_rls('activity_logs');

-- whatsapp_messages
DROP POLICY IF EXISTS whatsapp_all ON public.whatsapp_messages;
DROP POLICY IF EXISTS whatsapp_tenant_select ON public.whatsapp_messages;
DROP POLICY IF EXISTS whatsapp_tenant_insert ON public.whatsapp_messages;
DROP POLICY IF EXISTS whatsapp_tenant_update ON public.whatsapp_messages;
SELECT public.apply_tenant_rls('whatsapp_messages');

-- doctor_withdrawals — طبيب يُدرج طلبه
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

-- notifications — حسب المستلم + نفس العيادة
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

-- -----------------------------------------------------------------------------
-- 7) patients — سياسة أوسع للقراءة ضمن العيادة (كل الأدوار المرتبطة)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS patients_all ON public.patients;
DROP POLICY IF EXISTS patients_tenant_select ON public.patients;
DROP POLICY IF EXISTS patients_tenant_mutate ON public.patients;

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

-- patient_operations / treatments — الأطباء يقرأون ويُدرجون ضمن عيادتهم
DROP POLICY IF EXISTS operations_all ON public.patient_operations;
DROP POLICY IF EXISTS patient_operations_tenant ON public.patient_operations;
CREATE POLICY patient_operations_tenant ON public.patient_operations
  FOR ALL TO authenticated
  USING (public.tenant_can_access(clinic_id))
  WITH CHECK (public.tenant_can_access(clinic_id));

DROP POLICY IF EXISTS treatments_all ON public.treatments;
DROP POLICY IF EXISTS treatments_tenant ON public.treatments;
CREATE POLICY treatments_tenant ON public.treatments
  FOR ALL TO authenticated
  USING (public.tenant_can_access(clinic_id))
  WITH CHECK (public.tenant_can_access(clinic_id));

DROP POLICY IF EXISTS medical_logs_all ON public.medical_logs;
DROP POLICY IF EXISTS medical_logs_tenant ON public.medical_logs;
CREATE POLICY medical_logs_tenant ON public.medical_logs
  FOR ALL TO authenticated
  USING (public.tenant_can_access(clinic_id))
  WITH CHECK (public.tenant_can_access(clinic_id));

DROP POLICY IF EXISTS appointments_all ON public.appointments;
DROP POLICY IF EXISTS appointments_tenant ON public.appointments;
CREATE POLICY appointments_tenant ON public.appointments
  FOR ALL TO authenticated
  USING (public.tenant_can_access(clinic_id))
  WITH CHECK (public.tenant_can_access(clinic_id));

DROP POLICY IF EXISTS schedule_locks_all ON public.schedule_locks;
DROP POLICY IF EXISTS schedule_locks_tenant ON public.schedule_locks;
CREATE POLICY schedule_locks_tenant ON public.schedule_locks
  FOR ALL TO authenticated
  USING (public.tenant_can_access(clinic_id))
  WITH CHECK (public.tenant_can_access(clinic_id));

-- -----------------------------------------------------------------------------
-- 8) دالة ربط حساب قديم بأول عيادة (للحسابات بدون clinic_id)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.link_profile_to_first_clinic()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic_id UUID;
  v_current UUID;
BEGIN
  SELECT clinic_id INTO v_current
  FROM public.profiles WHERE id = auth.uid();

  IF v_current IS NOT NULL THEN
    RETURN 'already_linked:' || v_current;
  END IF;

  SELECT id INTO v_clinic_id FROM public.clinics ORDER BY created_at LIMIT 1;

  IF v_clinic_id IS NULL THEN
    RETURN 'no_clinic_found';
  END IF;

  UPDATE public.profiles
  SET clinic_id = v_clinic_id, role = COALESCE(role, 'accountant')
  WHERE id = auth.uid();

  RETURN 'linked:' || v_clinic_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- 9) دالة إنشاء عيادة + مالك (للاستدعاء من التطبيق أو يدوياً)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_create_clinic(
  p_name TEXT,
  p_name_ar TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_owner_email TEXT DEFAULT NULL,
  p_whatsapp_instance TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'platform_create_clinic: platform admin only';
  END IF;

  INSERT INTO public.clinics (
    name, name_ar, phone, owner_email,
    whatsapp_instance_name, whatsapp_session_id, is_active
  )
  VALUES (
    p_name,
    COALESCE(p_name_ar, p_name),
    p_phone,
    p_owner_email,
    p_whatsapp_instance,
    p_whatsapp_instance,
    TRUE
  )
  RETURNING id INTO v_id;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'seed_clinic_settings') THEN
    PERFORM public.seed_clinic_settings(v_id, 'dental');
  ELSIF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'seed_default_operation_types') THEN
    PERFORM public.seed_default_operation_types(v_id);
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.platform_create_clinic TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_admin_email TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_can_access TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_profile_to_first_clinic() TO authenticated;

-- -----------------------------------------------------------------------------
-- 10) تحقق سريع
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_admin TEXT;
  v_clinics INT;
  v_tables INT;
BEGIN
  SELECT value INTO v_admin FROM public.platform_settings WHERE key = 'admin_email';
  SELECT count(*) INTO v_clinics FROM public.clinics;
  SELECT count(*) INTO v_tables
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = c.oid AND a.attname = 'clinic_id' AND NOT a.attisdropped
    );

  RAISE NOTICE '✓ Multi-tenant applied';
  RAISE NOTICE '  Platform admin email: %', v_admin;
  RAISE NOTICE '  Clinics: %', v_clinics;
  RAISE NOTICE '  Tables with clinic_id: %', v_tables;
END $$;
