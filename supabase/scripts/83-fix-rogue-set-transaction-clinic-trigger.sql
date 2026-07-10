-- الإصلاح النهائي لخطأ "null value in column clinic_id" في كل مكان
-- (تأكيد صرف، حذف/تعديل حركة راتب، أي إدراج حركة مالية من الخادم).
--
-- السبب: Trigger قديم set_transaction_clinic() يُصفّر NEW.clinic_id بلا
-- شرط، معتمداً على owner_id = auth.uid() (نموذج قديم عيادة واحدة). أي
-- إدراج من الخادم (بلا جلسة auth.uid()) يفقد clinic_id الصحيح الممرَّر.
--
-- التنفيذ: نفس الدالة، فقط أضفنا شرط "إذا كانت NULL فقط" — يحترم أي
-- clinic_id صحيح ممرَّر مسبقاً، ويحافظ بالتوافقية للمسار القديم إن وُجد.

CREATE OR REPLACE FUNCTION public.set_transaction_clinic()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.clinic_id IS NULL THEN
    SELECT id INTO NEW.clinic_id
    FROM clinics
    WHERE owner_id = auth.uid()
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$function$;

-- تحقّق فوري: إدراج تجريبي بقيمة clinic_id صحيحة يجب أن ينجح الآن
-- (id بجدول transactions من نوع TEXT لا UUID — نستخدم النص مباشرة)
DO $$
DECLARE
  v_test_id TEXT := gen_random_uuid()::text;
BEGIN
  INSERT INTO public.transactions (
    id, clinic_id, amount, type, description_ar, transaction_date,
    reference_type, reference_id
  ) VALUES (
    v_test_id,
    '9186408c-ddca-447c-9107-879c2b73ee7a',
    -1,
    'assistant_payroll_doctor',
    'TEST — تحقق إصلاح Trigger (سيُحذف فوراً)',
    CURRENT_DATE,
    'diagnostic_test_delete_me',
    v_test_id
  );
  DELETE FROM public.transactions WHERE id = v_test_id;
  RAISE NOTICE 'نجح الإصلاح — clinic_id لم يُصفَّر';
END $$;
