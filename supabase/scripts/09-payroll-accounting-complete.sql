-- =============================================================================
-- سكربت واحد شامل — نظام الرواتب + المحاسبة
-- Master Clinic Plus
--
-- كيف تشغّله (خطوة بخطوة):
--   1) افتح https://supabase.com/dashboard
--   2) اختر مشروع العيادة
--   3) من القائمة: SQL Editor
--   4) New query
--   5) انسخ هذا الملف كاملاً والصقه هنا
--   6) اضغط Run (أو Ctrl+Enter)
--
-- آمن للتكرار — يمكن تشغيله أكثر من مرة بدون ضرر.
-- يجمع: 05 + 06 + 07 + 08 في ملف واحد.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- القسم 1: حقول راتب المساعد (كان: 05-assistant-salary-fields.sql)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.assistants
  ADD COLUMN IF NOT EXISTS total_salary DECIMAL(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.assistants
  ADD COLUMN IF NOT EXISTS doctor_share_percentage NUMERIC(5, 2) NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assistants_total_salary_check'
  ) THEN
    ALTER TABLE public.assistants
      ADD CONSTRAINT assistants_total_salary_check CHECK (total_salary >= 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assistants_doctor_share_percentage_check'
  ) THEN
    ALTER TABLE public.assistants
      ADD CONSTRAINT assistants_doctor_share_percentage_check
        CHECK (doctor_share_percentage >= 0 AND doctor_share_percentage <= 100);
  END IF;
END $$;

COMMENT ON COLUMN public.assistants.total_salary IS
  'الراتب الكلي الشهري للمساعد';
COMMENT ON COLUMN public.assistants.doctor_share_percentage IS
  'نسبة تحمّل الطبيب من راتب المساعد (0–100) — الباقي للعيادة';

-- ─────────────────────────────────────────────────────────────────────────────
-- القسم 2: جدول رواتب المساعدين الشهرية (كان: 06-assistant-payroll-records.sql)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  assistant_id UUID NOT NULL REFERENCES public.assistants(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  month_year TEXT NOT NULL CHECK (month_year ~ '^\d{4}-\d{2}$'),
  assistant_name_ar TEXT NOT NULL,
  doctor_name_ar TEXT,
  total_salary DECIMAL(12, 2) NOT NULL CHECK (total_salary >= 0),
  doctor_share_percentage NUMERIC(5, 2) NOT NULL
    CHECK (doctor_share_percentage >= 0 AND doctor_share_percentage <= 100),
  doctor_share_amount DECIMAL(12, 2) NOT NULL CHECK (doctor_share_amount >= 0),
  clinic_share_amount DECIMAL(12, 2) NOT NULL CHECK (clinic_share_amount >= 0),
  status TEXT NOT NULL DEFAULT 'generated'
    CHECK (status IN ('generated', 'paid')),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_records_assistant_month
  ON public.payroll_records(clinic_id, assistant_id, month_year);

CREATE INDEX IF NOT EXISTS idx_payroll_records_clinic_month
  ON public.payroll_records(clinic_id, month_year DESC);

CREATE INDEX IF NOT EXISTS idx_payroll_records_doctor_month
  ON public.payroll_records(doctor_id, month_year DESC);

DROP TRIGGER IF EXISTS trg_payroll_records_clinic ON public.payroll_records;
CREATE TRIGGER trg_payroll_records_clinic
  BEFORE INSERT ON public.payroll_records
  FOR EACH ROW EXECUTE FUNCTION public.set_clinic_id_from_profile();

ALTER TABLE public.payroll_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_records_tenant_select ON public.payroll_records;
DROP POLICY IF EXISTS payroll_records_tenant_mutate ON public.payroll_records;

CREATE POLICY payroll_records_tenant_select ON public.payroll_records
  FOR SELECT TO authenticated
  USING (public.tenant_can_access(clinic_id));

CREATE POLICY payroll_records_tenant_mutate ON public.payroll_records
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_records TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- القسم 3: راتب المحاسب + ربطه بقائمة الموظفين (كان: 07-profile-salary-fields.sql)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS base_salary DECIMAL(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS job_title TEXT;

ALTER TABLE public.staff_members
  ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS staff_members_profile_id_unique
  ON public.staff_members(profile_id)
  WHERE profile_id IS NOT NULL;

COMMENT ON COLUMN public.profiles.base_salary IS
  'الراتب الشهري — يُستخدم للمحاسبين في نظام الرواتب';
COMMENT ON COLUMN public.staff_members.profile_id IS
  'ربط موظف الخدمات بحساب محاسب (profiles)';

-- ─────────────────────────────────────────────────────────────────────────────
-- القسم 4: جدول الحركات المالية + حقول المرجع (كان: 08-financial-accounting.sql)
-- يدعم جدول transactions قديم موجود مسبقاً بأعمدة ناقصة
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  doctor_id UUID REFERENCES public.doctors(id) ON DELETE SET NULL,
  patient_id UUID REFERENCES public.patients(id) ON DELETE SET NULL,
  operation_id UUID REFERENCES public.patient_operations(id) ON DELETE SET NULL,
  amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'general',
  description_ar TEXT,
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reference_type TEXT,
  reference_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ترقية جدول قديم: إضافة أي عمود ناقص (آمن للتكرار)
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id) ON DELETE CASCADE;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS doctor_id UUID REFERENCES public.doctors(id) ON DELETE SET NULL;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES public.patients(id) ON DELETE SET NULL;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS operation_id UUID REFERENCES public.patient_operations(id) ON DELETE SET NULL;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS amount DECIMAL(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'general';

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS description_ar TEXT;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS transaction_date DATE NOT NULL DEFAULT CURRENT_DATE;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS reference_type TEXT;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS reference_id UUID;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- إن وُجد created_at فقط: املأ transaction_date منه للصفوف القديمة
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions'
      AND column_name = 'created_at'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions'
      AND column_name = 'transaction_date'
  ) THEN
    UPDATE public.transactions
    SET transaction_date = created_at::date
    WHERE transaction_date IS NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions'
      AND column_name = 'transaction_date'
  ) THEN
    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS idx_transactions_clinic_date
        ON public.transactions(clinic_id, transaction_date DESC)
    $idx$;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions'
      AND column_name = 'doctor_id'
  ) THEN
    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS idx_transactions_doctor
        ON public.transactions(doctor_id)
        WHERE doctor_id IS NOT NULL
    $idx$;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions'
      AND column_name = 'reference_type'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions'
      AND column_name = 'reference_id'
  ) THEN
    EXECUTE $idx$
      CREATE UNIQUE INDEX IF NOT EXISTS transactions_reference_unique
        ON public.transactions(clinic_id, reference_type, reference_id)
        WHERE reference_id IS NOT NULL
    $idx$;
  END IF;
END $$;

COMMENT ON COLUMN public.transactions.reference_type IS
  'expense | staff_salary_accrual | staff_salary_paid | assistant_payroll_doctor | assistant_payroll_clinic';

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transactions_tenant ON public.transactions;
CREATE POLICY transactions_tenant ON public.transactions
  FOR ALL TO authenticated
  USING (public.tenant_can_access(clinic_id))
  WITH CHECK (public.tenant_can_access(clinic_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- التحقق — شغّل وشوف النتائج تحت
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'assistants.total_salary' AS item,
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'assistants'
           AND column_name = 'total_salary'
       ) AS ok
UNION ALL
SELECT 'payroll_records table',
       EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'payroll_records'
       )
UNION ALL
SELECT 'profiles.base_salary',
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'profiles'
           AND column_name = 'base_salary'
       )
UNION ALL
SELECT 'staff_members.profile_id',
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'staff_members'
           AND column_name = 'profile_id'
       )
UNION ALL
SELECT 'transactions.reference_type',
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'transactions'
           AND column_name = 'reference_type'
       )
UNION ALL
SELECT 'transactions.reference_id',
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'transactions'
           AND column_name = 'reference_id'
       )
UNION ALL
SELECT 'transactions.transaction_date',
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'transactions'
           AND column_name = 'transaction_date'
       );

-- إذا كل الصفوف ok = true  →  كل شيء جاهز ✅
