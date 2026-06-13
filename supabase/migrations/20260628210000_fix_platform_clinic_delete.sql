-- Fix clinic delete failing when financial triggers re-run on FK SET NULL
-- (treatment_case_id cleared during CASCADE → UPDATE patient_operations → null doctor_share_total)

CREATE OR REPLACE FUNCTION public.calculate_operation_shares()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agreed         NUMERIC;
  v_total_paid     NUMERIC;
  v_locked         BOOLEAN;
  v_doc_pct        NUMERIC := 0.5;
  v_mat_share      NUMERIC := 0;
  v_payment_type   TEXT := 'percentage';
  v_doc_gross      NUMERIC;
  v_doc_share      NUMERIC;
  v_clinic_share   NUMERIC;
  v_is_plan        BOOLEAN;
  v_review_fee     NUMERIC;
  v_plan_total     NUMERIC;
  v_case_id        UUID;
  v_case_doc       NUMERIC;
  v_case_clinic    NUMERIC;
  v_case_paid      NUMERIC;
  v_new_paid       NUMERIC;
  v_case_final     NUMERIC;
  v_patient_doc    NUMERIC;
  v_patient_clinic NUMERIC;
BEGIN
  -- تجاهل تحديثات FK فقط (مثل treatment_case_id أو doctor_id أثناء CASCADE)
  IF TG_OP = 'UPDATE' AND (
    OLD.paid_amount IS NOT DISTINCT FROM NEW.paid_amount
    AND OLD.total_amount IS NOT DISTINCT FROM NEW.total_amount
    AND OLD.session_kind IS NOT DISTINCT FROM NEW.session_kind
    AND OLD.discount_amount IS NOT DISTINCT FROM NEW.discount_amount
    AND OLD.doctor_share_amount IS NOT DISTINCT FROM NEW.doctor_share_amount
    AND OLD.clinic_share_amount IS NOT DISTINCT FROM NEW.clinic_share_amount
    AND OLD.materials_cost IS NOT DISTINCT FROM NEW.materials_cost
    AND OLD.review_fee_amount IS NOT DISTINCT FROM NEW.review_fee_amount
    AND OLD.is_review_statement IS NOT DISTINCT FROM NEW.is_review_statement
  ) THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id = NEW.patient_id) THEN
    RETURN NEW;
  END IF;

  SELECT agreed_total, total_paid, financial_locked
  INTO v_agreed, v_total_paid, v_locked
  FROM public.patients
  WHERE id = NEW.patient_id;

  v_agreed := COALESCE(v_agreed, 0);
  v_total_paid := COALESCE(v_total_paid, 0);
  v_review_fee := COALESCE(NEW.review_fee_amount, 0);

  IF NEW.session_kind = 'refund' THEN
    NEW.total_amount := 0;
    NEW.materials_cost := COALESCE(NEW.materials_cost, 0);
    NEW.doctor_share_amount := COALESCE(NEW.doctor_share_amount, 0);
    NEW.clinic_share_amount := COALESCE(NEW.clinic_share_amount, 0);

    IF NEW.treatment_case_id IS NOT NULL THEN
      v_case_id := NEW.treatment_case_id;
      SELECT doctor_share_total, clinic_share_total, total_paid
      INTO v_case_doc, v_case_clinic, v_case_paid
      FROM public.patient_treatment_cases
      WHERE id = v_case_id;

      IF FOUND THEN
        v_new_paid := GREATEST(0, ROUND(v_case_paid + COALESCE(NEW.paid_amount, 0), 2));
        UPDATE public.patient_treatment_cases
        SET
          doctor_share_total = GREATEST(0, ROUND(v_case_doc - ABS(COALESCE(NEW.doctor_share_amount, 0)), 2)),
          clinic_share_total = GREATEST(0, ROUND(v_case_clinic - ABS(COALESCE(NEW.clinic_share_amount, 0)), 2)),
          total_paid = v_new_paid,
          status = CASE
            WHEN v_new_paid >= final_price AND final_price > 0 THEN 'completed'
            ELSE 'active'
          END,
          updated_at = now()
        WHERE id = v_case_id;
      END IF;
    ELSIF v_agreed > 0 THEN
      v_new_paid := GREATEST(0, ROUND(v_total_paid + COALESCE(NEW.paid_amount, 0), 2));
      UPDATE public.patients
      SET
        total_paid = v_new_paid,
        doctor_share_total = GREATEST(
          0,
          ROUND(COALESCE(doctor_share_total, 0) - ABS(COALESCE(NEW.doctor_share_amount, 0)), 2)
        ),
        clinic_share_total = GREATEST(
          0,
          ROUND(COALESCE(clinic_share_total, 0) - ABS(COALESCE(NEW.clinic_share_amount, 0)), 2)
        )
      WHERE id = NEW.patient_id;

      v_total_paid := v_new_paid;
      NEW.remaining_debt := GREATEST(0, v_agreed - v_total_paid);

      IF v_total_paid < v_agreed THEN
        UPDATE public.patients SET treatment_status = 'active' WHERE id = NEW.patient_id;
      END IF;
    ELSE
      NEW.remaining_debt := GREATEST(0, COALESCE(NEW.total_amount, 0) - COALESCE(NEW.paid_amount, 0));
    END IF;

    RETURN NEW;
  END IF;

  v_is_plan := (
    NEW.session_kind = 'plan'
    OR (COALESCE(NEW.total_amount, 0) > 0 AND NOT COALESCE(v_locked, FALSE))
  );

  IF v_is_plan AND (COALESCE(NEW.total_amount, 0) > 0 OR v_review_fee > 0) THEN
    v_plan_total := COALESCE(NEW.total_amount, 0) + v_review_fee;

    SELECT
      COALESCE(NULLIF(d.payment_type, ''), 'percentage'),
      (d.percentage::TEXT)::NUMERIC / 100,
      (d.materials_share::TEXT)::NUMERIC / 100
    INTO v_payment_type, v_doc_pct, v_mat_share
    FROM public.doctors d
    WHERE d.id = NEW.doctor_id;

    v_doc_pct := COALESCE(v_doc_pct, 0.5);
    v_mat_share := COALESCE(v_mat_share, 0);

    IF COALESCE(v_payment_type, 'percentage') = 'salary' THEN
      v_doc_share := 0;
      v_clinic_share := v_plan_total;
    ELSE
      v_doc_gross := COALESCE(NEW.total_amount, 0) * v_doc_pct;
      v_doc_share := v_doc_gross - (COALESCE(NEW.materials_cost, 0) * v_mat_share);
      v_clinic_share := (COALESCE(NEW.total_amount, 0) - v_doc_share) + v_review_fee;
    END IF;

    v_doc_share := COALESCE(v_doc_share, 0);
    v_clinic_share := COALESCE(v_clinic_share, 0);

    UPDATE public.patients
    SET
      agreed_total = v_plan_total,
      doctor_share_total = ROUND(v_doc_share::NUMERIC, 2),
      clinic_share_total = ROUND(v_clinic_share::NUMERIC, 2),
      previous_total = v_plan_total,
      financial_locked = TRUE,
      total_paid = total_paid + COALESCE(NEW.paid_amount, 0)
    WHERE id = NEW.patient_id;

    SELECT total_paid INTO v_total_paid FROM public.patients WHERE id = NEW.patient_id;

    NEW.session_kind := 'plan';
    IF COALESCE(v_payment_type, 'percentage') = 'salary' THEN
      NEW.doctor_share_amount := 0;
      NEW.clinic_share_amount := CASE
        WHEN COALESCE(NEW.paid_amount, 0) > 0 THEN ROUND(COALESCE(NEW.paid_amount, 0), 2)
        ELSE 0
      END;
    ELSIF COALESCE(NEW.paid_amount, 0) > 0 AND v_plan_total > 0 THEN
      NEW.doctor_share_amount := ROUND(NEW.paid_amount * v_doc_share / v_plan_total, 2);
      NEW.clinic_share_amount := ROUND(NEW.paid_amount * v_clinic_share / v_plan_total, 2);
    ELSE
      NEW.doctor_share_amount := 0;
      NEW.clinic_share_amount := 0;
    END IF;
    NEW.remaining_debt := GREATEST(0, v_plan_total - v_total_paid);

    RETURN NEW;
  END IF;

  NEW.session_kind := 'payment';
  NEW.total_amount := 0;
  NEW.materials_cost := COALESCE(NEW.materials_cost, 0);

  SELECT COALESCE(NULLIF(d.payment_type, ''), 'percentage')
  INTO v_payment_type
  FROM public.doctors d
  WHERE d.id = NEW.doctor_id;

  IF COALESCE(v_payment_type, 'percentage') = 'salary' THEN
    NEW.doctor_share_amount := 0;
    NEW.clinic_share_amount := ROUND(COALESCE(NEW.paid_amount, 0), 2);
  ELSIF NEW.treatment_case_id IS NOT NULL AND COALESCE(NEW.paid_amount, 0) > 0 THEN
    SELECT doctor_share_total, clinic_share_total, final_price
    INTO v_case_doc, v_case_clinic, v_case_final
    FROM public.patient_treatment_cases
    WHERE id = NEW.treatment_case_id;

    IF COALESCE(v_case_final, 0) > 0 THEN
      NEW.doctor_share_amount := ROUND(
        NEW.paid_amount * COALESCE(v_case_doc, 0) / v_case_final,
        2
      );
      NEW.clinic_share_amount := ROUND(
        NEW.paid_amount * COALESCE(v_case_clinic, 0) / v_case_final,
        2
      );
    ELSE
      NEW.doctor_share_amount := 0;
      NEW.clinic_share_amount := 0;
    END IF;
  ELSIF v_agreed > 0 AND COALESCE(NEW.paid_amount, 0) > 0 THEN
    SELECT doctor_share_total, clinic_share_total
    INTO v_patient_doc, v_patient_clinic
    FROM public.patients
    WHERE id = NEW.patient_id;

    NEW.doctor_share_amount := ROUND(
      NEW.paid_amount * COALESCE(v_patient_doc, 0) / v_agreed,
      2
    );
    NEW.clinic_share_amount := ROUND(
      NEW.paid_amount * COALESCE(v_patient_clinic, 0) / v_agreed,
      2
    );
  ELSE
    NEW.doctor_share_amount := 0;
    NEW.clinic_share_amount := 0;
  END IF;

  IF v_agreed > 0 THEN
    UPDATE public.patients
    SET total_paid = total_paid + COALESCE(NEW.paid_amount, 0)
    WHERE id = NEW.patient_id;

    SELECT total_paid INTO v_total_paid FROM public.patients WHERE id = NEW.patient_id;
    NEW.remaining_debt := GREATEST(0, v_agreed - v_total_paid);
  ELSE
    NEW.remaining_debt := GREATEST(0, COALESCE(NEW.total_amount, 0) - COALESCE(NEW.paid_amount, 0));
  END IF;

  RETURN NEW;
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

-- حذف الطبيب يحذف جلساته (لا SET NULL على doctor_id NOT NULL)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.patient_operations'::regclass
      AND c.contype = 'f'
      AND a.attname = 'doctor_id'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.patient_operations DROP CONSTRAINT IF EXISTS %I',
      r.conname
    );
  END LOOP;
END $$;

ALTER TABLE public.patient_operations
  ADD CONSTRAINT patient_operations_doctor_id_fkey
  FOREIGN KEY (doctor_id) REFERENCES public.doctors(id) ON DELETE CASCADE;

NOTIFY pgrst, 'reload schema';
