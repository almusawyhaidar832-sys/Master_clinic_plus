-- Unique short code per clinic for public booking URLs and QR codes
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS booking_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clinics_booking_code
  ON public.clinics (booking_code)
  WHERE booking_code IS NOT NULL;

COMMENT ON COLUMN public.clinics.booking_code IS
  'Short public code for /booking?clinic=CODE and QR scans';

-- Generate collision-resistant 8-char code (no ambiguous chars)
CREATE OR REPLACE FUNCTION public.generate_booking_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code TEXT;
  v_i INT;
  v_attempt INT := 0;
BEGIN
  LOOP
    v_code := '';
    FOR v_i IN 1..8 LOOP
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::INT, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.clinics c WHERE c.booking_code = v_code
    );
    v_attempt := v_attempt + 1;
    IF v_attempt > 50 THEN
      RAISE EXCEPTION 'Could not generate unique booking_code';
    END IF;
  END LOOP;
  RETURN v_code;
END;
$$;

-- Backfill existing clinics
UPDATE public.clinics
SET booking_code = public.generate_booking_code()
WHERE booking_code IS NULL OR booking_code = '';

-- Auto-assign on new clinic
CREATE OR REPLACE FUNCTION public.set_clinic_booking_code()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.booking_code IS NULL OR btrim(NEW.booking_code) = '' THEN
    NEW.booking_code := public.generate_booking_code();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_clinic_booking_code ON public.clinics;
CREATE TRIGGER trg_set_clinic_booking_code
  BEFORE INSERT ON public.clinics
  FOR EACH ROW
  EXECUTE FUNCTION public.set_clinic_booking_code();
