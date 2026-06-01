-- Master Clinic Plus — Competitive Features Migration
-- patient_queue, expense_categories, patient extras, activity_log
-- Run in Supabase SQL Editor

-- =============================================================================
-- 1. PATIENT TABLE EXTRAS (gender, birth_date)
-- =============================================================================
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS gender       TEXT CHECK (gender IN ('male','female')),
  ADD COLUMN IF NOT EXISTS birth_date   DATE,
  ADD COLUMN IF NOT EXISTS patient_code TEXT; -- رقم ملف مميز لكل مريض

-- Auto-generate patient_code on insert
CREATE OR REPLACE FUNCTION public.generate_patient_code()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INT;
BEGIN
  IF NEW.patient_code IS NULL THEN
    SELECT COUNT(*) + 1 INTO v_count
    FROM public.patients WHERE clinic_id = NEW.clinic_id;
    NEW.patient_code := 'P-' || LPAD(v_count::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_patient_code ON public.patients;
CREATE TRIGGER trg_patient_code
  BEFORE INSERT ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.generate_patient_code();

-- =============================================================================
-- 2. EXPENSE CATEGORIES
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.expense_categories (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id  UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name_ar    TEXT NOT NULL,
  color      TEXT DEFAULT '#6366f1',
  icon       TEXT DEFAULT 'receipt',
  is_active  BOOLEAN DEFAULT TRUE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.expense_categories(id) ON DELETE SET NULL;

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS exp_cat_all ON public.expense_categories;
CREATE POLICY exp_cat_all ON public.expense_categories FOR ALL
  USING (public.tenant_can_access(clinic_id))
  WITH CHECK (public.tenant_can_access(clinic_id) AND public.get_my_role() IN ('accountant','super_admin'));

-- Seed default categories per clinic
CREATE OR REPLACE FUNCTION public.seed_expense_categories(p_clinic_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.expense_categories (clinic_id, name_ar, color, icon, sort_order) VALUES
    (p_clinic_id, 'إيجار',             '#ef4444', 'building',      1),
    (p_clinic_id, 'رواتب',             '#f97316', 'users',         2),
    (p_clinic_id, 'مواد استهلاكية',    '#eab308', 'package',       3),
    (p_clinic_id, 'مختبر',             '#22c55e', 'flask',         4),
    (p_clinic_id, 'صيانة وإصلاح',      '#3b82f6', 'wrench',        5),
    (p_clinic_id, 'كهرباء وماء',       '#8b5cf6', 'zap',           6),
    (p_clinic_id, 'تسويق وإعلان',      '#ec4899', 'megaphone',     7),
    (p_clinic_id, 'أخرى',              '#6b7280', 'more-horizontal',99)
  ON CONFLICT DO NOTHING;
END;
$$;

-- Back-fill existing clinics
SELECT public.seed_expense_categories(id) FROM public.clinics
WHERE id NOT IN (SELECT DISTINCT clinic_id FROM public.expense_categories WHERE clinic_id IS NOT NULL);

-- =============================================================================
-- 3. PATIENT QUEUE (غرفة الانتظار الحية)
-- =============================================================================
DO $$ BEGIN
  CREATE TYPE public.queue_status AS ENUM (
    'waiting',      -- في الانتظار
    'called',       -- تم النداء
    'in_progress',  -- داخل الكشف
    'done',         -- منتهية
    'cancelled'     -- ألغى / غادر
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.queue_source AS ENUM (
    'walk_in',    -- مراجع مباشر
    'appointment',-- من موعد مسبق
    'online'      -- من الحجز الإلكتروني
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.patient_queue (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id      UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  doctor_id      UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  -- Patient info (either linked or walk-in name)
  patient_id     UUID REFERENCES public.patients(id) ON DELETE SET NULL,
  patient_name   TEXT,                          -- للمراجع السريع بدون ملف
  patient_phone  TEXT,
  -- Queue state
  ticket_number  INT NOT NULL,
  status         public.queue_status NOT NULL DEFAULT 'waiting',
  source         public.queue_source NOT NULL DEFAULT 'walk_in',
  -- Linked appointment (if from schedule)
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  -- Notes & timing
  notes          TEXT,
  queue_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  called_at      TIMESTAMPTZ,
  entered_at     TIMESTAMPTZ,
  done_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Ensure unique ticket per doctor per day
  UNIQUE (clinic_id, doctor_id, ticket_number, queue_date)
);

CREATE INDEX IF NOT EXISTS idx_queue_clinic_date
  ON public.patient_queue (clinic_id, queue_date, status);
CREATE INDEX IF NOT EXISTS idx_queue_doctor_date
  ON public.patient_queue (doctor_id, queue_date);

-- Auto-assign ticket number per doctor per day
CREATE OR REPLACE FUNCTION public.assign_ticket_number()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_next INT;
BEGIN
  SELECT COALESCE(MAX(ticket_number), 0) + 1
  INTO v_next
  FROM public.patient_queue
  WHERE doctor_id = NEW.doctor_id
    AND queue_date = NEW.queue_date
    AND clinic_id  = NEW.clinic_id;

  NEW.ticket_number := v_next;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_ticket ON public.patient_queue;
CREATE TRIGGER trg_assign_ticket
  BEFORE INSERT ON public.patient_queue
  FOR EACH ROW EXECUTE FUNCTION public.assign_ticket_number();

-- Auto-fill timestamps on status transitions
CREATE OR REPLACE FUNCTION public.queue_status_timestamps()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'called'      AND OLD.status = 'waiting'  THEN NEW.called_at  := NOW(); END IF;
  IF NEW.status = 'in_progress' AND OLD.status = 'called'   THEN NEW.entered_at := NOW(); END IF;
  IF NEW.status = 'done'                                     THEN NEW.done_at    := NOW(); END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_queue_timestamps ON public.patient_queue;
CREATE TRIGGER trg_queue_timestamps
  BEFORE UPDATE ON public.patient_queue
  FOR EACH ROW EXECUTE FUNCTION public.queue_status_timestamps();

-- RLS
ALTER TABLE public.patient_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS queue_select ON public.patient_queue;
CREATE POLICY queue_select ON public.patient_queue FOR SELECT
  USING (public.tenant_can_access(clinic_id));

DROP POLICY IF EXISTS queue_insert ON public.patient_queue;
CREATE POLICY queue_insert ON public.patient_queue FOR INSERT
  WITH CHECK (public.tenant_can_access(clinic_id));

DROP POLICY IF EXISTS queue_update ON public.patient_queue;
CREATE POLICY queue_update ON public.patient_queue FOR UPDATE
  USING (public.tenant_can_access(clinic_id))
  WITH CHECK (public.tenant_can_access(clinic_id));

DROP POLICY IF EXISTS queue_delete ON public.patient_queue;
CREATE POLICY queue_delete ON public.patient_queue FOR DELETE
  USING (public.tenant_can_access(clinic_id) AND public.get_my_role() IN ('accountant','super_admin'));

-- =============================================================================
-- 4. ACTIVITY LOG (سجل النشاطات — Audit Trail)
-- =============================================================================
DO $$ BEGIN
  CREATE TYPE public.activity_action AS ENUM (
    'create', 'update', 'delete', 'login', 'logout',
    'approve_withdrawal', 'reject_withdrawal', 'pay_withdrawal',
    'print', 'export'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.activity_logs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id    UUID REFERENCES public.clinics(id) ON DELETE CASCADE,
  profile_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action       public.activity_action NOT NULL,
  entity_type  TEXT NOT NULL,   -- 'patient', 'operation', 'withdrawal', etc.
  entity_id    UUID,
  description  TEXT NOT NULL,   -- نص واضح: "أضاف عملية حشوة للمريض أحمد"
  metadata     JSONB DEFAULT '{}',  -- بيانات إضافية (القيم القديمة/الجديدة)
  ip_address   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_clinic_date
  ON public.activity_logs (clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_profile
  ON public.activity_logs (profile_id, created_at DESC);

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS activity_select ON public.activity_logs;
CREATE POLICY activity_select ON public.activity_logs FOR SELECT
  USING (public.tenant_can_access(clinic_id) AND public.get_my_role() IN ('accountant','super_admin'));

DROP POLICY IF EXISTS activity_insert ON public.activity_logs;
CREATE POLICY activity_insert ON public.activity_logs FOR INSERT
  WITH CHECK (public.tenant_can_access(clinic_id));

-- =============================================================================
-- 5. CLINIC FINANCIAL SNAPSHOT (للـ Executive Dashboard)
-- RPC دالة واحدة تُرجع كل الأرقام التي يحتاجها صاحب العيادة
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_clinic_financial_snapshot(
  p_clinic_id UUID,
  p_from DATE DEFAULT DATE_TRUNC('month', CURRENT_DATE)::DATE,
  p_to   DATE DEFAULT CURRENT_DATE
)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_revenue          NUMERIC := 0;
  v_collected        NUMERIC := 0;
  v_debt             NUMERIC := 0;
  v_doctor_shares    NUMERIC := 0;
  v_clinic_shares    NUMERIC := 0;
  v_expenses         NUMERIC := 0;
  v_withdrawals_paid NUMERIC := 0;
  v_materials        NUMERIC := 0;
  v_net_profit       NUMERIC := 0;
  v_patient_count    INT := 0;
  v_new_patients     INT := 0;
  v_op_count         INT := 0;
  v_prev_revenue     NUMERIC := 0;
  v_prev_expenses    NUMERIC := 0;
  v_days             INT;
  v_prev_from        DATE;
  v_prev_to          DATE;
BEGIN
  IF NOT public.tenant_can_access(p_clinic_id) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  -- Current period
  SELECT
    COALESCE(SUM(po.total_amount), 0),
    COALESCE(SUM(po.paid_amount), 0),
    COALESCE(SUM(po.remaining_debt), 0),
    COALESCE(SUM(po.doctor_share_amount), 0),
    COALESCE(SUM(po.clinic_share_amount), 0),
    COALESCE(SUM(po.materials_cost), 0),
    COUNT(*)
  INTO v_revenue, v_collected, v_debt, v_doctor_shares, v_clinic_shares, v_materials, v_op_count
  FROM public.patient_operations po
  WHERE po.clinic_id = p_clinic_id
    AND po.operation_date BETWEEN p_from AND p_to;

  SELECT COALESCE(SUM(amount), 0) INTO v_expenses
  FROM public.expenses
  WHERE clinic_id = p_clinic_id
    AND expense_date BETWEEN p_from AND p_to;

  SELECT COALESCE(SUM(amount), 0) INTO v_withdrawals_paid
  FROM public.doctor_withdrawals
  WHERE clinic_id = p_clinic_id
    AND status = 'paid'
    AND processed_at::DATE BETWEEN p_from AND p_to;

  SELECT COUNT(DISTINCT patient_id) INTO v_patient_count
  FROM public.patient_operations
  WHERE clinic_id = p_clinic_id
    AND operation_date BETWEEN p_from AND p_to;

  SELECT COUNT(*) INTO v_new_patients
  FROM public.patients
  WHERE clinic_id = p_clinic_id
    AND created_at::DATE BETWEEN p_from AND p_to;

  -- Net profit = clinic share − expenses
  v_net_profit := v_clinic_shares - v_expenses;

  -- Previous period (same duration) for comparison
  v_days := (p_to - p_from);
  v_prev_to   := p_from - 1;
  v_prev_from := v_prev_to - v_days;

  SELECT COALESCE(SUM(total_amount), 0) INTO v_prev_revenue
  FROM public.patient_operations
  WHERE clinic_id = p_clinic_id
    AND operation_date BETWEEN v_prev_from AND v_prev_to;

  SELECT COALESCE(SUM(amount), 0) INTO v_prev_expenses
  FROM public.expenses
  WHERE clinic_id = p_clinic_id
    AND expense_date BETWEEN v_prev_from AND v_prev_to;

  RETURN json_build_object(
    -- Core numbers
    'revenue',           ROUND(v_revenue, 2),
    'collected',         ROUND(v_collected, 2),
    'debt',              ROUND(v_debt, 2),
    'doctor_shares',     ROUND(v_doctor_shares, 2),
    'clinic_shares',     ROUND(v_clinic_shares, 2),
    'materials_cost',    ROUND(v_materials, 2),
    'expenses',          ROUND(v_expenses, 2),
    'withdrawals_paid',  ROUND(v_withdrawals_paid, 2),
    'net_profit',        ROUND(v_net_profit, 2),
    -- Activity
    'operation_count',   v_op_count,
    'patient_count',     v_patient_count,
    'new_patients',      v_new_patients,
    -- Comparison (growth %)
    'prev_revenue',      ROUND(v_prev_revenue, 2),
    'prev_expenses',     ROUND(v_prev_expenses, 2),
    'revenue_growth',    CASE WHEN v_prev_revenue = 0 THEN NULL
                              ELSE ROUND(((v_revenue - v_prev_revenue) / v_prev_revenue) * 100, 1) END,
    -- Period
    'period_from',       p_from,
    'period_to',         p_to
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_clinic_financial_snapshot(UUID, DATE, DATE) TO authenticated;

-- =============================================================================
-- 6. TOP PERFORMERS RPC (أفضل طبيب + أكثر خدمة)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_top_performers(
  p_clinic_id UUID,
  p_from DATE DEFAULT DATE_TRUNC('month', CURRENT_DATE)::DATE,
  p_to   DATE DEFAULT CURRENT_DATE
)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_top_doctors  JSON;
  v_top_services JSON;
  v_top_expenses JSON;
BEGIN
  IF NOT public.tenant_can_access(p_clinic_id) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  -- Top 5 doctors by revenue
  SELECT json_agg(row_to_json(d)) INTO v_top_doctors FROM (
    SELECT
      doc.full_name_ar,
      ROUND(SUM(po.total_amount)::NUMERIC, 2)        AS revenue,
      ROUND(SUM(po.doctor_share_amount)::NUMERIC, 2) AS doctor_share,
      COUNT(*)                                        AS op_count
    FROM public.patient_operations po
    JOIN public.doctors doc ON doc.id = po.doctor_id
    WHERE po.clinic_id = p_clinic_id
      AND po.operation_date BETWEEN p_from AND p_to
    GROUP BY doc.id, doc.full_name_ar
    ORDER BY revenue DESC
    LIMIT 5
  ) d;

  -- Top 5 services by count & revenue
  SELECT json_agg(row_to_json(s)) INTO v_top_services FROM (
    SELECT
      po.operation_name_ar                          AS service_name,
      COUNT(*)                                      AS count,
      ROUND(SUM(po.total_amount)::NUMERIC, 2)       AS revenue,
      ROUND(AVG(po.total_amount)::NUMERIC, 2)       AS avg_price,
      ROUND(AVG(CASE WHEN po.total_amount > 0
        THEN (po.clinic_share_amount / po.total_amount) * 100
        ELSE 0 END)::NUMERIC, 1)                    AS clinic_margin_pct
    FROM public.patient_operations po
    WHERE po.clinic_id = p_clinic_id
      AND po.operation_date BETWEEN p_from AND p_to
    GROUP BY po.operation_name_ar
    ORDER BY revenue DESC
    LIMIT 5
  ) s;

  -- Top expense categories
  SELECT json_agg(row_to_json(e)) INTO v_top_expenses FROM (
    SELECT
      COALESCE(ec.name_ar, 'غير مصنف') AS category,
      ROUND(SUM(ex.amount)::NUMERIC, 2) AS total,
      COUNT(*)                          AS count
    FROM public.expenses ex
    LEFT JOIN public.expense_categories ec ON ec.id = ex.category_id
    WHERE ex.clinic_id = p_clinic_id
      AND ex.expense_date BETWEEN p_from AND p_to
    GROUP BY ec.name_ar
    ORDER BY total DESC
    LIMIT 5
  ) e;

  RETURN json_build_object(
    'top_doctors',  COALESCE(v_top_doctors,  '[]'::JSON),
    'top_services', COALESCE(v_top_services, '[]'::JSON),
    'top_expenses', COALESCE(v_top_expenses, '[]'::JSON)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_top_performers(UUID, DATE, DATE) TO authenticated;

-- =============================================================================
-- 7. QUEUE STATS RPC (للـ receptionist dashboard)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_queue_stats(p_clinic_id UUID, p_date DATE DEFAULT CURRENT_DATE)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_waiting    INT := 0;
  v_called     INT := 0;
  v_in_prog    INT := 0;
  v_done       INT := 0;
  v_total      INT := 0;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE status = 'waiting'),
    COUNT(*) FILTER (WHERE status = 'called'),
    COUNT(*) FILTER (WHERE status = 'in_progress'),
    COUNT(*) FILTER (WHERE status = 'done'),
    COUNT(*)
  INTO v_waiting, v_called, v_in_prog, v_done, v_total
  FROM public.patient_queue
  WHERE clinic_id = p_clinic_id AND queue_date = p_date;

  RETURN json_build_object(
    'waiting',     v_waiting,
    'called',      v_called,
    'in_progress', v_in_prog,
    'done',        v_done,
    'total',       v_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_queue_stats(UUID, DATE) TO authenticated;
