-- إضافة نوع حركة «مكافأة» لرواتب الموظفين
DO $$ BEGIN
  ALTER TYPE public.salary_entry_type ADD VALUE 'bonus';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
