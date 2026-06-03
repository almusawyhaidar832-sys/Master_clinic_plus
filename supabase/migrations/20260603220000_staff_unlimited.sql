-- Allow unlimited staff per clinic (remove 7-employee cap)

ALTER TABLE public.staff_members
  DROP CONSTRAINT IF EXISTS staff_members_slot_number_check;

-- Legacy installs may use auto-generated check names
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.staff_members'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%slot_number%'
      AND pg_get_constraintdef(oid) ILIKE '%7%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.staff_members DROP CONSTRAINT IF EXISTS %I',
      r.conname
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
