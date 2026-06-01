-- Ensure all FK relationships exist (safe to run even if they already exist)
-- This fixes "relationship not found in schema cache" PostgREST errors

-- patient_operations → patients
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY'
      AND table_name = 'patient_operations'
      AND constraint_name LIKE '%patient_id%'
  ) THEN
    ALTER TABLE public.patient_operations
      ADD CONSTRAINT patient_operations_patient_id_fkey
      FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;
  END IF;
END $$;

-- patient_operations → doctors
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY'
      AND table_name = 'patient_operations'
      AND constraint_name LIKE '%doctor_id%'
  ) THEN
    ALTER TABLE public.patient_operations
      ADD CONSTRAINT patient_operations_doctor_id_fkey
      FOREIGN KEY (doctor_id) REFERENCES public.doctors(id);
  END IF;
END $$;

-- doctor_withdrawals → doctors
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY'
      AND table_name = 'doctor_withdrawals'
      AND constraint_name LIKE '%doctor_id%'
  ) THEN
    ALTER TABLE public.doctor_withdrawals
      ADD CONSTRAINT doctor_withdrawals_doctor_id_fkey
      FOREIGN KEY (doctor_id) REFERENCES public.doctors(id) ON DELETE CASCADE;
  END IF;
END $$;

-- salary_entries → staff_members
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY'
      AND table_name = 'salary_entries'
      AND constraint_name LIKE '%staff_id%'
  ) THEN
    ALTER TABLE public.salary_entries
      ADD CONSTRAINT salary_entries_staff_id_fkey
      FOREIGN KEY (staff_id) REFERENCES public.staff_members(id) ON DELETE CASCADE;
  END IF;
END $$;

-- salary_slips → staff_members
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY'
      AND table_name = 'salary_slips'
      AND constraint_name LIKE '%staff_id%'
  ) THEN
    ALTER TABLE public.salary_slips
      ADD CONSTRAINT salary_slips_staff_id_fkey
      FOREIGN KEY (staff_id) REFERENCES public.staff_members(id) ON DELETE CASCADE;
  END IF;
END $$;

-- profiles → clinics (FK for clinic_id)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY'
      AND table_name = 'profiles'
      AND constraint_name LIKE '%clinic_id%'
  ) THEN
    -- Allow null (profile not yet linked to a clinic)
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_clinic_id_fkey
      FOREIGN KEY (clinic_id) REFERENCES public.clinics(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Force PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';
