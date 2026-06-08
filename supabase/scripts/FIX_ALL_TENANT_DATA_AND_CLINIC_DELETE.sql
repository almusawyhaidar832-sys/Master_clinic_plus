-- =============================================================================
-- Master Clinic Plus — إصلاح شامل للبيانات القديمة + حذف عيادة نهائي
-- انسخ الملف كاملاً إلى Supabase → SQL Editor → Run
-- آمن لإعادة التشغيل (ما عدا حذف العيادة — لا تشغّل القسم D إلا عمداً)
-- =============================================================================

-- =============================================================================
-- A) عزل العيادات (RLS) + tenant_can_access
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_my_clinic_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT clinic_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.tenant_can_access(p_clinic_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_clinic_id IS NOT NULL
     AND p_clinic_id = public.get_my_clinic_id();
$$;

ALTER TABLE public.patient_treatment_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_treatment_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_treatment_cases_tenant ON public.patient_treatment_cases;
CREATE POLICY patient_treatment_cases_tenant ON public.patient_treatment_cases
  FOR ALL
  USING (public.tenant_can_access(clinic_id))
  WITH CHECK (public.tenant_can_access(clinic_id));

DROP POLICY IF EXISTS patient_treatment_plans_tenant ON public.patient_treatment_plans;
CREATE POLICY patient_treatment_plans_tenant ON public.patient_treatment_plans
  FOR ALL
  USING (public.tenant_can_access(clinic_id))
  WITH CHECK (public.tenant_can_access(clinic_id));

-- =============================================================================
-- B) إصلاح رصيد الطبيب (من المدفوع)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.calc_doctor_operation_earned(
  p_doctor_id UUID,
  p_doctor_share_amount NUMERIC,
  p_paid_amount NUMERIC,
  p_treatment_case_id UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_share NUMERIC; v_paid NUMERIC; v_case_doc NUMERIC; v_case_final NUMERIC; v_pct NUMERIC;
BEGIN
  v_share := COALESCE(p_doctor_share_amount, 0);
  IF v_share <> 0 THEN RETURN ROUND(v_share, 2); END IF;
  v_paid := COALESCE(p_paid_amount, 0);
  IF v_paid = 0 THEN RETURN 0; END IF;
  IF p_treatment_case_id IS NOT NULL THEN
    SELECT doctor_share_total, final_price INTO v_case_doc, v_case_final
    FROM public.patient_treatment_cases WHERE id = p_treatment_case_id;
    IF COALESCE(v_case_final, 0) > 0 AND COALESCE(v_case_doc, 0) > 0 THEN
      RETURN ROUND(v_paid * (v_case_doc / v_case_final), 2);
    END IF;
  END IF;
  SELECT (d.percentage::TEXT)::NUMERIC / 100 INTO v_pct FROM public.doctors d WHERE d.id = p_doctor_id;
  RETURN ROUND(v_paid * COALESCE(v_pct, 0.5), 2);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_doctor_wallet_stats(p_doctor_id UUID)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_clinic_id UUID; v_earned NUMERIC; v_paid_out NUMERIC; v_pending NUMERIC; v_approved NUMERIC;
BEGIN
  SELECT clinic_id INTO v_clinic_id FROM public.doctors WHERE id = p_doctor_id;
  IF v_clinic_id IS NULL THEN RETURN json_build_object('error', 'doctor_not_found'); END IF;
  IF auth.uid() IS NOT NULL AND NOT public.tenant_can_access(v_clinic_id) THEN
    RAISE EXCEPTION 'access denied';
  END IF;
  SELECT COALESCE(SUM(public.calc_doctor_operation_earned(
    po.doctor_id, po.doctor_share_amount, po.paid_amount, po.treatment_case_id
  )), 0) INTO v_earned FROM public.patient_operations po WHERE po.doctor_id = p_doctor_id;
  SELECT COALESCE(SUM(amount), 0) INTO v_paid_out FROM public.doctor_withdrawals
  WHERE doctor_id = p_doctor_id AND status = 'paid';
  SELECT COALESCE(SUM(amount), 0) INTO v_pending FROM public.doctor_withdrawals
  WHERE doctor_id = p_doctor_id AND status = 'pending';
  SELECT COALESCE(SUM(amount), 0) INTO v_approved FROM public.doctor_withdrawals
  WHERE doctor_id = p_doctor_id AND status = 'approved';
  RETURN json_build_object(
    'total_earnings', ROUND(v_earned, 2),
    'total_withdrawn', ROUND(v_paid_out, 2),
    'pending_amount', ROUND(v_pending, 2),
    'approved_amount', ROUND(v_approved, 2),
    'available_balance', ROUND(GREATEST(0, v_earned - v_paid_out - v_approved), 2),
    'withdrawable_limit', ROUND(GREATEST(0, v_earned - v_paid_out - v_approved - v_pending), 2)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.calc_doctor_operation_earned(UUID, NUMERIC, NUMERIC, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_doctor_wallet_stats(UUID) TO authenticated, service_role;

-- =============================================================================
-- C) دالة إصلاح البيانات القديمة — تشغّل مرة واحدة
-- =============================================================================

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
  -- 1) توحيد clinic_id للعمليات مع المريض
  UPDATE public.patient_operations po
  SET clinic_id = p.clinic_id
  FROM public.patients p
  WHERE po.patient_id = p.id
    AND po.clinic_id IS DISTINCT FROM p.clinic_id;
  GET DIAGNOSTICS v_ops_clinic = ROW_COUNT;

  -- 2) توحيد clinic_id لحالات العلاج
  UPDATE public.patient_treatment_cases tc
  SET clinic_id = p.clinic_id
  FROM public.patients p
  WHERE tc.patient_id = p.id
    AND tc.clinic_id IS DISTINCT FROM p.clinic_id;
  GET DIAGNOSTICS v_cases_clinic = ROW_COUNT;

  -- 3) توحيد clinic_id لخطط العلاج
  UPDATE public.patient_treatment_plans tp
  SET clinic_id = p.clinic_id
  FROM public.patients p
  WHERE tp.patient_id = p.id
    AND tp.clinic_id IS DISTINCT FROM p.clinic_id;
  GET DIAGNOSTICS v_plans_clinic = ROW_COUNT;

  -- 4) ربط primary_doctor_id للحالات من أول عملية
  UPDATE public.patient_treatment_cases c
  SET primary_doctor_id = sub.doctor_id
  FROM (
    SELECT DISTINCT ON (po.treatment_case_id)
      po.treatment_case_id, po.doctor_id
    FROM public.patient_operations po
    WHERE po.treatment_case_id IS NOT NULL AND po.doctor_id IS NOT NULL
    ORDER BY po.treatment_case_id, po.operation_date ASC, po.created_at ASC
  ) sub
  WHERE c.id = sub.treatment_case_id
    AND (c.primary_doctor_id IS NULL OR c.primary_doctor_id <> sub.doctor_id);
  GET DIAGNOSTICS v_case_doctor = ROW_COUNT;

  -- 5) ربط primary_doctor_id للمرضى من آخر حالة
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

  -- 6) مرضى بدون حالات — من آخر عملية
  UPDATE public.patients p
  SET primary_doctor_id = sub.doctor_id
  FROM (
    SELECT DISTINCT ON (patient_id) patient_id, doctor_id
    FROM public.patient_operations
    WHERE doctor_id IS NOT NULL
    ORDER BY patient_id, operation_date DESC, created_at DESC
  ) sub
  WHERE p.id = sub.patient_id AND p.primary_doctor_id IS NULL;

  -- 7) حذف عمليات يتيمة (مريض محذوف)
  DELETE FROM public.patient_operations po
  WHERE NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.id = po.patient_id);
  GET DIAGNOSTICS v_orphan_ops = ROW_COUNT;

  -- 8) ربط treatment_case_id الناقص من نفس المريض والتاريخ
  UPDATE public.patient_operations po
  SET treatment_case_id = c.id
  FROM public.patient_treatment_cases c
  WHERE po.treatment_case_id IS NULL
    AND po.patient_id = c.patient_id
    AND po.clinic_id = c.clinic_id
    AND c.status = 'active'
    AND po.session_kind IN ('plan', 'payment')
    AND NOT EXISTS (
      SELECT 1 FROM public.patient_operations po2
      WHERE po2.treatment_case_id = c.id AND po2.id <> po.id
    );

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

GRANT EXECUTE ON FUNCTION public.platform_repair_all_tenant_data() TO service_role;

-- =============================================================================
-- D) حذف عيادة نهائياً (كل البيانات + حسابات الدخول + ملفات الأشعة)
-- استدعاء: SELECT public.platform_delete_clinic_completely('معرّف-العيادة-uuid');
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

  -- ملفات الأشعة في Storage
  BEGIN
    DELETE FROM storage.objects
    WHERE bucket_id = 'clinical-xrays'
      AND (
        name LIKE p_clinic_id::text || '/%'
        OR name LIKE '%/' || p_clinic_id::text || '/%'
      );
    GET DIAGNOSTICS v_storage = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_storage := 0;
  END;

  -- مرتجعات قبل العمليات (RESTRICT)
  DELETE FROM public.session_refunds WHERE clinic_id = p_clinic_id;

  -- حسابات Supabase Auth للطاقم (يحذف profiles تلقائياً CASCADE)
  IF v_user_ids IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = ANY(v_user_ids);
    GET DIAGNOSTICS v_users = ROW_COUNT;
  END IF;

  -- حذف العيادة — CASCADE لباقي الجداول:
  -- patients, doctors, patient_operations, appointments, expenses,
  -- patient_queue, whatsapp_messages, notifications, clinic_settings, ...
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
GRANT EXECUTE ON FUNCTION public.platform_delete_clinic_completely(UUID) TO service_role;

-- =============================================================================
-- E) تشغيل الإصلاح الآن
-- =============================================================================

SELECT public.platform_repair_all_tenant_data() AS repair_result;

-- =============================================================================
-- F) فحص سريع بعد الإصلاح (اختياري — راجع النتائج)
-- =============================================================================

-- ملفات شخصية وعياداتهم
SELECT p.username, p.full_name, p.role, c.name_ar AS clinic
FROM public.profiles p
LEFT JOIN public.clinics c ON c.id = p.clinic_id
ORDER BY c.name_ar NULLS LAST, p.created_at;

-- عمليات clinic_id لا يطابق المريض (المفروض 0)
SELECT COUNT(*) AS mismatched_operations
FROM public.patient_operations po
JOIN public.patients p ON p.id = po.patient_id
WHERE po.clinic_id IS DISTINCT FROM p.clinic_id;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- G) لحذف عيادة معيّنة يدوياً (غيّر UUID ثم شغّل السطر فقط)
-- =============================================================================
-- SELECT public.platform_delete_clinic_completely('00000000-0000-0000-0000-000000000000');
