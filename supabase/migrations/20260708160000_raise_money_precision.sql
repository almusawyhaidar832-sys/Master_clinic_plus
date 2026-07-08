-- رفع دقة المبالغ المالية من NUMERIC(12,2) إلى NUMERIC(18,2)
-- الحد القديم: ~9,999,999,999.99 | الجديد: ~9,999,999,999,999,999.99

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_paid_not_exceed_total;

-- ─── invoices (remaining_amount قد يكون عموداً محسوباً) ───
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invoices'
      AND column_name = 'remaining_amount'
      AND is_generated = 'ALWAYS'
  ) THEN
    ALTER TABLE public.invoices DROP COLUMN remaining_amount;
  END IF;
END $$;

ALTER TABLE public.invoices
  ALTER COLUMN total_amount TYPE NUMERIC(18, 2),
  ALTER COLUMN paid_amount TYPE NUMERIC(18, 2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invoices'
      AND column_name = 'remaining_amount'
  ) THEN
    ALTER TABLE public.invoices
      ADD COLUMN remaining_amount NUMERIC(18, 2)
        GENERATED ALWAYS AS (total_amount - paid_amount) STORED;
  ELSE
    ALTER TABLE public.invoices
      ALTER COLUMN remaining_amount TYPE NUMERIC(18, 2);
  END IF;
END $$;

-- ─── invoices_history ───
ALTER TABLE public.invoices_history
  ALTER COLUMN total_amount TYPE NUMERIC(18, 2),
  ALTER COLUMN paid_amount TYPE NUMERIC(18, 2),
  ALTER COLUMN remaining_amount TYPE NUMERIC(18, 2),
  ALTER COLUMN doctor_share TYPE NUMERIC(18, 2),
  ALTER COLUMN clinic_share TYPE NUMERIC(18, 2);

-- ─── patient_operations ───
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'patient_operations'
      AND column_name = 'remaining_debt'
      AND is_generated = 'ALWAYS'
  ) THEN
    ALTER TABLE public.patient_operations DROP COLUMN remaining_debt;
  END IF;
END $$;

ALTER TABLE public.patient_operations
  ALTER COLUMN total_amount TYPE NUMERIC(18, 2),
  ALTER COLUMN paid_amount TYPE NUMERIC(18, 2);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'patient_operations'
      AND column_name = 'remaining_debt'
  ) THEN
    ALTER TABLE public.patient_operations
      ALTER COLUMN remaining_debt TYPE NUMERIC(18, 2);
  ELSE
    ALTER TABLE public.patient_operations
      ADD COLUMN remaining_debt NUMERIC(18, 2)
        GENERATED ALWAYS AS (total_amount - paid_amount) STORED;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'patient_operations'
      AND column_name = 'doctor_share_amount'
  ) THEN
    ALTER TABLE public.patient_operations
      ALTER COLUMN doctor_share_amount TYPE NUMERIC(18, 2);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'patient_operations'
      AND column_name = 'clinic_share_amount'
  ) THEN
    ALTER TABLE public.patient_operations
      ALTER COLUMN clinic_share_amount TYPE NUMERIC(18, 2);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'patient_operations'
      AND column_name = 'materials_cost'
  ) THEN
    ALTER TABLE public.patient_operations
      ALTER COLUMN materials_cost TYPE NUMERIC(18, 2);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'patient_operations'
      AND column_name = 'discount_amount'
  ) THEN
    ALTER TABLE public.patient_operations
      ALTER COLUMN discount_amount TYPE NUMERIC(18, 2);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'patient_operations'
      AND column_name = 'review_fee_amount'
  ) THEN
    ALTER TABLE public.patient_operations
      ALTER COLUMN review_fee_amount TYPE NUMERIC(18, 2);
  END IF;
END $$;

-- ─── patient_treatment_cases ───
ALTER TABLE public.patient_treatment_cases
  ALTER COLUMN case_price TYPE NUMERIC(18, 2),
  ALTER COLUMN discount_total TYPE NUMERIC(18, 2),
  ALTER COLUMN final_price TYPE NUMERIC(18, 2),
  ALTER COLUMN doctor_share_total TYPE NUMERIC(18, 2),
  ALTER COLUMN clinic_share_total TYPE NUMERIC(18, 2),
  ALTER COLUMN total_paid TYPE NUMERIC(18, 2);

-- ─── patients (ذمة المراجع) ───
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'patients'
      AND column_name = 'agreed_total'
  ) THEN
    ALTER TABLE public.patients
      ALTER COLUMN agreed_total TYPE NUMERIC(18, 2),
      ALTER COLUMN original_agreed_total TYPE NUMERIC(18, 2),
      ALTER COLUMN discount_total TYPE NUMERIC(18, 2),
      ALTER COLUMN doctor_share_total TYPE NUMERIC(18, 2),
      ALTER COLUMN clinic_share_total TYPE NUMERIC(18, 2),
      ALTER COLUMN total_paid TYPE NUMERIC(18, 2);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'patients'
      AND column_name = 'previous_total'
  ) THEN
    ALTER TABLE public.patients
      ALTER COLUMN previous_total TYPE NUMERIC(18, 2);
  END IF;
END $$;

-- ─── session_refunds ───
DO $$
BEGIN
  IF to_regclass('public.session_refunds') IS NOT NULL THEN
    ALTER TABLE public.session_refunds
      ALTER COLUMN amount TYPE NUMERIC(18, 2),
      ALTER COLUMN doctor_share_deduction TYPE NUMERIC(18, 2),
      ALTER COLUMN clinic_share_deduction TYPE NUMERIC(18, 2);
  END IF;
END $$;

-- ─── doctor_expenses ───
DO $$
BEGIN
  IF to_regclass('public.doctor_expenses') IS NOT NULL THEN
    ALTER TABLE public.doctor_expenses
      ALTER COLUMN amount TYPE NUMERIC(18, 2);
  END IF;
END $$;

-- ─── transactions ───
DO $$
BEGIN
  IF to_regclass('public.transactions') IS NOT NULL THEN
    ALTER TABLE public.transactions
      ALTER COLUMN amount TYPE NUMERIC(18, 2);
  END IF;
END $$;

COMMENT ON COLUMN public.invoices.total_amount IS
  'إجمالي الفاتورة — NUMERIC(18,2)';

COMMENT ON COLUMN public.invoices.paid_amount IS
  'المبلغ المدفوع — قد يتجاوز الإجمالي (دفعة زائدة)';

COMMENT ON COLUMN public.invoices.remaining_amount IS
  'المتبقي = الإجمالي − المدفوع (قد يكون سالباً)';
