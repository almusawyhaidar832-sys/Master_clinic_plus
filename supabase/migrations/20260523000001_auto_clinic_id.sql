-- Auto-set clinic_id on INSERT from authenticated user's profile

CREATE OR REPLACE FUNCTION public.set_clinic_id_from_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.clinic_id IS NULL THEN
    NEW.clinic_id := public.get_my_clinic_id();
  END IF;
  IF NEW.clinic_id IS NULL THEN
    RAISE EXCEPTION 'clinic_id required';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_patients_clinic BEFORE INSERT ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.set_clinic_id_from_profile();

CREATE TRIGGER trg_operations_clinic BEFORE INSERT ON public.patient_operations
  FOR EACH ROW EXECUTE FUNCTION public.set_clinic_id_from_profile();

CREATE TRIGGER trg_doctors_clinic BEFORE INSERT ON public.doctors
  FOR EACH ROW EXECUTE FUNCTION public.set_clinic_id_from_profile();

CREATE TRIGGER trg_expenses_clinic BEFORE INSERT ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_clinic_id_from_profile();
