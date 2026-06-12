-- شغّل في Supabase SQL Editor — خصم/مكافأة لكل العاملين بما فيهم المساعدون
ALTER TABLE public.salary_entries
  ALTER COLUMN staff_id DROP NOT NULL;

ALTER TABLE public.salary_entries
  ADD COLUMN IF NOT EXISTS assistant_id UUID REFERENCES public.assistants(id) ON DELETE CASCADE;

ALTER TABLE public.salary_entries
  DROP CONSTRAINT IF EXISTS salary_entries_staff_or_assistant_check;

ALTER TABLE public.salary_entries
  ADD CONSTRAINT salary_entries_staff_or_assistant_check CHECK (
    (staff_id IS NOT NULL AND assistant_id IS NULL)
    OR (staff_id IS NULL AND assistant_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_salary_entries_assistant_date
  ON public.salary_entries (assistant_id, entry_date DESC)
  WHERE assistant_id IS NOT NULL;
