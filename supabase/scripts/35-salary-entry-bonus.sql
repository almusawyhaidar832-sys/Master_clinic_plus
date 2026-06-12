-- شغّل في Supabase SQL Editor لإضافة مكافآت الرواتب
DO $$ BEGIN
  ALTER TYPE public.salary_entry_type ADD VALUE 'bonus';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
