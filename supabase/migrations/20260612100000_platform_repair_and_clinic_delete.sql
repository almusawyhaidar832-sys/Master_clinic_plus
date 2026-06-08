-- دوال إصلاح البيانات وحذف العيادة نهائياً (تُستدعى من لوحة المطور)
-- السكربت الكامل مع الإصلاح الفوري: supabase/scripts/FIX_ALL_TENANT_DATA_AND_CLINIC_DELETE.sql

CREATE OR REPLACE FUNCTION public.platform_repair_all_tenant_data()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ops_clinic INT := 0;
  v_cases_clinic INT := 0;
  v_plans_clinic INT := 0;
  v_case_doctor INT := 0;
  v_patient_doctor INT := 0;
  v_orphan_ops INT := 0;
BEGIN
  UPDATE public.patient_operations po
  SET clinic_id = p.clinic_id
  FROM public.patients p
  WHERE po.patient_id = p.id AND po.clinic_id IS DISTINCT FROM p.clinic_id;
  GET DIAGNOSTICS v_ops_clinic = ROW_COUNT;

  UPDATE public.patient_treatment_cases tc
  SET clinic_id = p.clinic_id
  FROM public.patients p
  WHERE tc.patient_id = p.id AND tc.clinic_id IS DISTINCT FROM p.clinic_id;
  GET DIAGNOSTICS v_cases_clinic = ROW_COUNT;

  UPDATE public.patient_treatment_plans tp
  SET clinic_id = p.clinic_id
  FROM public.patients p
  WHERE tp.patient_id = p.id AND tp.clinic_id IS DISTINCT FROM p.clinic_id;
  GET DIAGNOSTICS v_plans_clinic = ROW_COUNT;

  UPDATE public.patient_treatment_cases c
  SET primary_doctor_id = sub.doctor_id
  FROM (
    SELECT DISTINCT ON (po.treatment_case_id) po.treatment_case_id, po.doctor_id
    FROM public.patient_operations po
    WHERE po.treatment_case_id IS NOT NULL AND po.doctor_id IS NOT NULL
    ORDER BY po.treatment_case_id, po.operation_date ASC, po.created_at ASC
  ) sub
  WHERE c.id = sub.treatment_case_id
    AND (c.primary_doctor_id IS NULL OR c.primary_doctor_id <> sub.doctor_id);
  GET DIAGNOSTICS v_case_doctor = ROW_COUNT;

  UPDATE public.patients p
  SET primary_doctor_id = sub.primary_doctor_id
  FROM (
    SELECT DISTINCT ON (patient_id) patient_id, primary_doctor_id
    FROM public.patient_treatment_cases
    WHERE primary_doctor_id IS NOT NULL
    ORDER BY patient_id, updated_at DESC NULLS LAST, created_at DESC
  ) sub
  WHERE p.id = sub.patient_id
    AND (p.primary_doctor_id IS NULL OR p.primary_doctor_id <> sub.primary_doctor_id);
  GET DIAGNOSTICS v_patient_doctor = ROW_COUNT;

  UPDATE public.patients p
  SET primary_doctor_id = sub.doctor_id
  FROM (
    SELECT DISTINCT ON (patient_id) patient_id, doctor_id
    FROM public.patient_operations
    WHERE doctor_id IS NOT NULL
    ORDER BY patient_id, operation_date DESC, created_at DESC
  ) sub
  WHERE p.id = sub.patient_id AND p.primary_doctor_id IS NULL;

  DELETE FROM public.patient_operations po
  WHERE NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.id = po.patient_id);
  GET DIAGNOSTICS v_orphan_ops = ROW_COUNT;

  RETURN json_build_object(
    'ok', true,
    'operations_clinic_fixed', v_ops_clinic,
    'treatment_cases_clinic_fixed', v_cases_clinic,
    'treatment_plans_clinic_fixed', v_plans_clinic,
    'case_primary_doctor_fixed', v_case_doctor,
    'patient_primary_doctor_fixed', v_patient_doctor,
    'orphan_operations_deleted', v_orphan_ops
  );
END;
$$;

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

  DELETE FROM public.session_refunds WHERE clinic_id = p_clinic_id;

  IF v_user_ids IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = ANY(v_user_ids);
    GET DIAGNOSTICS v_users = ROW_COUNT;
  END IF;

  DELETE FROM public.clinics WHERE id = p_clinic_id;

  RETURN json_build_object(
    'ok', true,
    'clinic_name', v_name,
    'auth_users_deleted', COALESCE(v_users, 0),
    'storage_files_deleted', v_storage,
    'message', 'تم حذف العيادة وجميع بياناتها نهائياً'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.platform_delete_clinic_completely(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_repair_all_tenant_data() TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_delete_clinic_completely(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
