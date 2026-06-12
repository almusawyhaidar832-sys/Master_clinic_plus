-- إصلاح: link_profile_to_first_clinic — شغّل هذا إذا توقف APPLY_MULTI_TENANT_COMPLETE عند GRANT
-- ثم أعد تشغيل APPLY_MULTI_TENANT_COMPLETE.sql من البداية (أو اكتفِ بهذا + رسالة ✓ في النهاية)

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

GRANT EXECUTE ON FUNCTION public.link_profile_to_first_clinic() TO authenticated;
