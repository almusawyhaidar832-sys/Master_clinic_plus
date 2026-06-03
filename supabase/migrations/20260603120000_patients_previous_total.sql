-- Remember last session total per patient (for follow-up visits)

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS previous_total DECIMAL(12, 2) DEFAULT 0 CHECK (previous_total >= 0);

COMMENT ON COLUMN public.patients.previous_total IS
  'Last operation total_amount — used when accountant leaves total empty on next session';

CREATE OR REPLACE FUNCTION public.sync_patient_previous_total()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.patients
  SET previous_total = NEW.total_amount
  WHERE id = NEW.patient_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_patient_previous_total ON public.patient_operations;
CREATE TRIGGER trg_sync_patient_previous_total
  AFTER INSERT OR UPDATE OF total_amount ON public.patient_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_patient_previous_total();

-- Backfill from latest operation per patient
UPDATE public.patients p
SET previous_total = sub.last_total
FROM (
  SELECT DISTINCT ON (patient_id)
    patient_id,
    total_amount AS last_total
  FROM public.patient_operations
  ORDER BY patient_id, created_at DESC
) sub
WHERE p.id = sub.patient_id
  AND (p.previous_total IS NULL OR p.previous_total = 0);
