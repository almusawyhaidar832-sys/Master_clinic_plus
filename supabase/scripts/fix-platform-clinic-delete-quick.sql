-- =============================================================================
-- إصلاح سريع لحذف العيادة (شغّل هذا فقط إذا شغّلت السكript الكبير سابقاً)
-- Supabase → SQL Editor → Run
-- =============================================================================

CREATE OR REPLACE FUNCTION public.platform_delete_clinic_completely(p_clinic_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, storage
AS $$
DECLARE
  v_name TEXT;
  v_user_ids UUID[];
  v_storage INT := 0;
  v_users INT := 0;
  v_ops_deleted INT := 0;
BEGIN
  IF p_clinic_id IS NULL THEN
    RETURN json_build_object('error', 'clinic_id_required');
  END IF;

  SELECT COALESCE(name_ar, name) INTO v_name
  FROM public.clinics WHERE id = p_clinic_id;

  IF v_name IS NULL THEN
    RETURN json_build_object('error', 'clinic_not_found');
  END IF;

  SELECT ARRAY_AGG(id) INTO v_user_ids
  FROM public.profiles WHERE clinic_id = p_clinic_id;

  BEGIN
    DELETE FROM storage.objects
    WHERE bucket_id = 'clinical-xrays'
      AND (name LIKE p_clinic_id::text || '/%' OR name LIKE '%/' || p_clinic_id::text || '/%');
    GET DIAGNOSTICS v_storage = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_storage := 0;
  END;

  ALTER TABLE public.patient_operations DISABLE TRIGGER USER;

  BEGIN
    DELETE FROM public.session_refunds WHERE clinic_id = p_clinic_id;

    BEGIN
      DELETE FROM public.invoices_history WHERE clinic_id = p_clinic_id;
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
    BEGIN
      DELETE FROM public.invoices WHERE clinic_id = p_clinic_id;
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
    BEGIN
      DELETE FROM public.patient_prescriptions WHERE clinic_id = p_clinic_id;
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
    BEGIN
      DELETE FROM public.operation_xray_images WHERE clinic_id = p_clinic_id;
      DELETE FROM public.operation_tooth_records WHERE clinic_id = p_clinic_id;
    EXCEPTION WHEN undefined_table THEN NULL;
    END;

    DELETE FROM public.patient_operations po
    WHERE po.clinic_id = p_clinic_id
       OR po.patient_id IN (SELECT id FROM public.patients WHERE clinic_id = p_clinic_id)
       OR po.doctor_id IN (SELECT id FROM public.doctors WHERE clinic_id = p_clinic_id);
    GET DIAGNOSTICS v_ops_deleted = ROW_COUNT;

    BEGIN
      DELETE FROM public.appointments WHERE clinic_id = p_clinic_id;
      DELETE FROM public.patient_queue WHERE clinic_id = p_clinic_id;
      DELETE FROM public.treatments WHERE clinic_id = p_clinic_id;
      DELETE FROM public.medical_logs WHERE clinic_id = p_clinic_id;
      DELETE FROM public.patient_doctor_transfers WHERE clinic_id = p_clinic_id;
      DELETE FROM public.push_subscriptions WHERE clinic_id = p_clinic_id;
    EXCEPTION WHEN undefined_table THEN NULL;
    END;

    UPDATE public.doctors SET profile_id = NULL WHERE clinic_id = p_clinic_id;
    BEGIN
      UPDATE public.staff_members SET profile_id = NULL WHERE clinic_id = p_clinic_id;
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
    BEGIN
      UPDATE public.assistants SET profile_id = NULL WHERE clinic_id = p_clinic_id;
    EXCEPTION WHEN undefined_table THEN NULL;
    END;

    DELETE FROM public.doctors WHERE clinic_id = p_clinic_id;

    IF v_user_ids IS NOT NULL THEN
      DELETE FROM auth.users WHERE id = ANY(v_user_ids);
      GET DIAGNOSTICS v_users = ROW_COUNT;
    END IF;

    DELETE FROM public.clinics WHERE id = p_clinic_id;
  EXCEPTION WHEN OTHERS THEN
    ALTER TABLE public.patient_operations ENABLE TRIGGER USER;
    RETURN json_build_object('error', SQLERRM);
  END;

  ALTER TABLE public.patient_operations ENABLE TRIGGER USER;

  RETURN json_build_object(
    'ok', true,
    'clinic_name', v_name,
    'auth_users_deleted', COALESCE(v_users, 0),
    'storage_files_deleted', v_storage,
    'operations_deleted', v_ops_deleted,
    'message', 'تم حذف العيادة وجميع بياناتها نهائياً'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.platform_delete_clinic_completely(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_delete_clinic_completely(UUID) TO service_role;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.doctors'::regclass AND c.contype = 'f' AND a.attname = 'profile_id'
  LOOP
    EXECUTE format('ALTER TABLE public.doctors DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.doctors
  ADD CONSTRAINT doctors_profile_id_fkey
  FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';

-- تحقق:
-- SELECT prosrc LIKE '%DELETE FROM public.doctors WHERE clinic_id%' AS ok
-- FROM pg_proc WHERE proname = 'platform_delete_clinic_completely';
