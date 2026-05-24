-- Allow clinic staff to send notifications (e.g. doctor withdrawal alerts)
CREATE POLICY notifications_insert_clinic ON public.notifications FOR INSERT
WITH CHECK (clinic_id = public.get_my_clinic_id());

-- Auto clinic_id on additional tables
CREATE TRIGGER trg_appointments_clinic BEFORE INSERT ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.set_clinic_id_from_profile();

CREATE TRIGGER trg_schedule_locks_clinic BEFORE INSERT ON public.schedule_locks
  FOR EACH ROW EXECUTE FUNCTION public.set_clinic_id_from_profile();

CREATE TRIGGER trg_medical_logs_clinic BEFORE INSERT ON public.medical_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_clinic_id_from_profile();

CREATE TRIGGER trg_salary_entries_clinic BEFORE INSERT ON public.salary_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_clinic_id_from_profile();

CREATE TRIGGER trg_staff_clinic BEFORE INSERT ON public.staff_members
  FOR EACH ROW EXECUTE FUNCTION public.set_clinic_id_from_profile();

CREATE TRIGGER trg_salary_slips_clinic BEFORE INSERT ON public.salary_slips
  FOR EACH ROW EXECUTE FUNCTION public.set_clinic_id_from_profile();

CREATE TRIGGER trg_withdrawals_clinic BEFORE INSERT ON public.doctor_withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.set_clinic_id_from_profile();
