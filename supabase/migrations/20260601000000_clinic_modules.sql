-- Master Clinic Plus — Dynamic Module System
-- Adds clinic_specialty + clinic_settings with enabled_modules JSONB

-- =============================================================================
-- ENSURE helper functions exist
-- These are originally defined in earlier migrations but re-declared here
-- safely (CREATE OR REPLACE) so this file runs standalone in SQL Editor.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.get_my_clinic_id() CASCADE;
CREATE OR REPLACE FUNCTION public.get_my_clinic_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT clinic_id FROM public.profiles WHERE id = auth.uid();
$$;

DROP FUNCTION IF EXISTS public.get_my_role() CASCADE;
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS public.user_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

DROP FUNCTION IF EXISTS public.is_super_admin() CASCADE;
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin'
  );
$$;

DROP FUNCTION IF EXISTS public.tenant_can_access(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.tenant_can_access(p_clinic_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin()
    OR (p_clinic_id IS NOT NULL AND p_clinic_id = public.get_my_clinic_id());
$$;

-- =============================================================================
-- ENUM: clinic_specialty
-- =============================================================================
DO $$ BEGIN
  CREATE TYPE public.clinic_specialty AS ENUM (
    'dental',           -- طب الأسنان
    'general_medicine', -- الطب العام / باطنية
    'cosmetic',         -- تجميل
    'pediatrics',       -- طب الأطفال
    'ophthalmology',    -- طب العيون
    'physiotherapy',    -- علاج طبيعي
    'custom'            -- مخصص (يد حرة)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- TABLE: clinic_settings
-- One row per clinic — single source of truth for module config
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.clinic_settings (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id    UUID NOT NULL UNIQUE REFERENCES public.clinics(id) ON DELETE CASCADE,
  specialty    public.clinic_specialty NOT NULL DEFAULT 'dental',
  -- JSONB array of enabled module keys, e.g. ["dental_chart","appointments","billing"]
  enabled_modules JSONB NOT NULL DEFAULT '[]'::JSONB,
  -- Per-module config (thresholds, labels, etc.) — optional
  module_config   JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clinic_settings_clinic
  ON public.clinic_settings(clinic_id);

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_clinic_settings_updated ON public.clinic_settings;
CREATE TRIGGER trg_clinic_settings_updated
  BEFORE UPDATE ON public.clinic_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE public.clinic_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY clinic_settings_select ON public.clinic_settings
  FOR SELECT USING (public.tenant_can_access(clinic_id));

CREATE POLICY clinic_settings_mutate ON public.clinic_settings
  FOR ALL
  USING (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  )
  WITH CHECK (
    public.tenant_can_access(clinic_id)
    AND public.get_my_role() IN ('accountant', 'super_admin')
  );

-- =============================================================================
-- FUNCTION: seed_clinic_settings
-- Called once per clinic on creation — sets default modules per specialty
-- =============================================================================
CREATE OR REPLACE FUNCTION public.seed_clinic_settings(
  p_clinic_id UUID,
  p_specialty  public.clinic_specialty DEFAULT 'dental'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_modules JSONB;
BEGIN
  -- Core modules always enabled for every specialty
  v_modules := '["appointments","patients","billing","reports","doctor_wallet","whatsapp","patient_queue","online_booking"]'::JSONB;

  -- Specialty-specific modules
  CASE p_specialty
    WHEN 'dental' THEN
      v_modules := v_modules || '["dental_chart","ortho_schedule","lab_prosthetics","smart_prescriptions","inventory"]'::JSONB;

    WHEN 'general_medicine' THEN
      v_modules := v_modules || '["lab_integration","pharmacy_link","vital_signs","smart_prescriptions","inventory"]'::JSONB;

    WHEN 'cosmetic' THEN
      v_modules := v_modules || '["treatment_plans","photo_gallery","smart_prescriptions"]'::JSONB;

    WHEN 'pediatrics' THEN
      v_modules := v_modules || '["lab_integration","pharmacy_link","vital_signs","growth_chart","smart_prescriptions"]'::JSONB;

    WHEN 'ophthalmology' THEN
      v_modules := v_modules || '["vision_chart","lab_integration","smart_prescriptions","inventory"]'::JSONB;

    WHEN 'physiotherapy' THEN
      v_modules := v_modules || '["session_plans","progress_tracking","inventory"]'::JSONB;

    WHEN 'custom' THEN
      -- All modules unlocked — admin cherry-picks
      v_modules := '["appointments","patients","billing","reports","doctor_wallet","whatsapp","patient_queue","online_booking","dental_chart","ortho_schedule","lab_prosthetics","lab_integration","pharmacy_link","vital_signs","smart_prescriptions","inventory","treatment_plans","photo_gallery","growth_chart","vision_chart","session_plans","progress_tracking"]'::JSONB;

    ELSE
      NULL;
  END CASE;

  INSERT INTO public.clinic_settings (clinic_id, specialty, enabled_modules)
  VALUES (p_clinic_id, p_specialty, v_modules)
  ON CONFLICT (clinic_id) DO UPDATE
    SET specialty        = EXCLUDED.specialty,
        enabled_modules  = EXCLUDED.enabled_modules,
        updated_at       = NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_clinic_settings(UUID, public.clinic_specialty) TO authenticated;

-- =============================================================================
-- Auto-seed settings when a new clinic is inserted (defaults to 'dental')
-- =============================================================================
CREATE OR REPLACE FUNCTION public.auto_seed_clinic_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_clinic_settings(NEW.id, 'dental');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_seed_clinic_settings ON public.clinics;
CREATE TRIGGER trg_auto_seed_clinic_settings
  AFTER INSERT ON public.clinics
  FOR EACH ROW EXECUTE FUNCTION public.auto_seed_clinic_settings();

-- =============================================================================
-- Back-fill existing clinics (one-time)
-- =============================================================================
INSERT INTO public.clinic_settings (clinic_id, specialty, enabled_modules)
SELECT
  id,
  'dental'::public.clinic_specialty,
  '["appointments","patients","billing","reports","doctor_wallet","whatsapp","patient_queue","online_booking","dental_chart","ortho_schedule","lab_prosthetics","smart_prescriptions","inventory"]'::JSONB
FROM public.clinics
WHERE id NOT IN (SELECT clinic_id FROM public.clinic_settings)
ON CONFLICT (clinic_id) DO NOTHING;
