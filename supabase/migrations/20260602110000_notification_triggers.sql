-- Auto notifications via DB triggers (works even if frontend API fails)

CREATE OR REPLACE FUNCTION public.notify_staff_on_withdrawal_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doctor_name TEXT;
BEGIN
  IF NEW.source IS DISTINCT FROM 'doctor_request' AND TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  SELECT full_name_ar INTO v_doctor_name
  FROM public.doctors WHERE id = NEW.doctor_id;

  INSERT INTO public.notifications (clinic_id, recipient_profile_id, title_ar, body_ar, link_path)
  SELECT
    NEW.clinic_id,
    p.id,
    'طلب سحب من طبيب',
    'طلب ' || COALESCE(v_doctor_name, 'طبيب') || ' سحب مبلغ ' || NEW.amount::text || ' ج.م',
    '/dashboard/withdrawals'
  FROM public.profiles p
  WHERE p.clinic_id = NEW.clinic_id
    AND p.role IN ('accountant', 'super_admin')
    AND p.is_active = TRUE;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_withdrawal_request ON public.doctor_withdrawals;
CREATE TRIGGER trg_notify_withdrawal_request
  AFTER INSERT ON public.doctor_withdrawals
  FOR EACH ROW
  WHEN (NEW.source = 'doctor_request' OR NEW.source IS NULL)
  EXECUTE FUNCTION public.notify_staff_on_withdrawal_request();

CREATE OR REPLACE FUNCTION public.notify_doctor_on_withdrawal_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id UUID;
  v_title TEXT;
  v_body  TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status NOT IN ('approved', 'paid', 'rejected') THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('approved', 'paid', 'rejected') THEN
    RETURN NEW;
  END IF;

  SELECT profile_id INTO v_profile_id
  FROM public.doctors WHERE id = NEW.doctor_id;

  IF v_profile_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_title := CASE NEW.status
    WHEN 'approved' THEN 'تمت الموافقة على طلب السحب'
    WHEN 'paid'     THEN 'تم صرف مبلغ السحب'
    WHEN 'rejected' THEN 'تم رفض طلب السحب'
    ELSE 'تحديث طلب السحب'
  END;

  v_body := CASE NEW.status
    WHEN 'paid' THEN 'تم سحب ' || NEW.amount::text || ' ج.م من محفظتك'
    ELSE v_title || ' — ' || NEW.amount::text || ' ج.م'
  END;

  INSERT INTO public.notifications (clinic_id, recipient_profile_id, title_ar, body_ar, link_path)
  VALUES (NEW.clinic_id, v_profile_id, v_title, v_body, '/doctor/wallet');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_withdrawal_status ON public.doctor_withdrawals;
CREATE TRIGGER trg_notify_withdrawal_status
  AFTER INSERT OR UPDATE OF status ON public.doctor_withdrawals
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_doctor_on_withdrawal_status();

CREATE OR REPLACE FUNCTION public.notify_doctor_on_new_operation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id UUID;
  v_patient_name TEXT;
  v_op_name TEXT;
BEGIN
  SELECT profile_id INTO v_profile_id
  FROM public.doctors WHERE id = NEW.doctor_id;

  IF v_profile_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT full_name_ar INTO v_patient_name
  FROM public.patients WHERE id = NEW.patient_id;

  v_op_name := COALESCE(
    NEW.operation_name_ar,
    (SELECT name_ar FROM public.operation_types WHERE id = NEW.operation_type_id LIMIT 1),
    'جلسة'
  );

  INSERT INTO public.notifications (clinic_id, recipient_profile_id, title_ar, body_ar, link_path)
  VALUES (
    NEW.clinic_id,
    v_profile_id,
    'مراجع / جلسة جديدة',
    COALESCE(v_patient_name, 'مريض') || ' — ' || v_op_name || ' — ' || NEW.total_amount::text || ' ج.م',
    '/doctor/patients'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_new_operation ON public.patient_operations;
CREATE TRIGGER trg_notify_new_operation
  AFTER INSERT ON public.patient_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_doctor_on_new_operation();
