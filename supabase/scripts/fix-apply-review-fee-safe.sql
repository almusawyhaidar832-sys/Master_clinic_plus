-- إصلاح trigger كشفية المراجع لقواعد بدون operation_type_id
-- شغّل قبل link-operations-to-treatment-cases.sql إذا ظهر خطأ apply_review_fee

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS review_fee_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS review_fee_amount DECIMAL(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.patient_operations
  ADD COLUMN IF NOT EXISTS review_fee_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_review_statement BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.apply_review_fee()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic_fee DECIMAL(12, 2);
  v_type_fee DECIMAL(12, 2);
BEGIN
  NEW.review_fee_amount := COALESCE(NEW.review_fee_amount, 0);

  IF NOT COALESCE(NEW.is_review_statement, FALSE) THEN
    NEW.review_fee_amount := 0;
    RETURN NEW;
  END IF;

  IF NEW.review_fee_amount > 0 THEN
    RETURN NEW;
  END IF;

  -- بحث برسوم المراجعة حسب اسم الإجراء (بدون operation_type_id)
  IF COALESCE(TRIM(NEW.operation_name_ar), '') <> '' THEN
    SELECT ot.review_fee_amount INTO v_type_fee
    FROM public.operation_types ot
    WHERE ot.clinic_id = NEW.clinic_id
      AND lower(trim(ot.name_ar)) = lower(trim(NEW.operation_name_ar))
    LIMIT 1;

    IF v_type_fee IS NOT NULL AND v_type_fee > 0 THEN
      NEW.review_fee_amount := v_type_fee;
      RETURN NEW;
    END IF;
  END IF;

  SELECT c.review_fee_amount INTO v_clinic_fee
  FROM public.clinics c
  WHERE c.id = NEW.clinic_id AND c.review_fee_enabled = TRUE;

  NEW.review_fee_amount := COALESCE(v_clinic_fee, 0);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_review_fee ON public.patient_operations;
CREATE TRIGGER trg_apply_review_fee
  BEFORE INSERT OR UPDATE ON public.patient_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_review_fee();

NOTIFY pgrst, 'reload schema';

SELECT 'fix-apply-review-fee-safe done' AS status;
