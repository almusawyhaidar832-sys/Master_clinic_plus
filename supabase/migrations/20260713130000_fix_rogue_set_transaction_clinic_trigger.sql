-- السبب الجذري لكل أخطاء "null value in column clinic_id" أثناء تأكيد
-- الصرف والحذف: Trigger قديم set_transaction_clinic() كان يُصفّر
-- NEW.clinic_id بلا شرط (SELECT ... INTO بدون IF)، معتمداً على نموذج
-- عيادة واحدة/مالك واحد (clinics.owner_id = auth.uid()) — غير متوافق مع
-- تعدد العيادات والعمليات من الخادم (Service Role، بلا auth.uid()).
--
-- أي إدراج حركة من الخادم (تأكيد صرف، تصحيح حذف/تعديل) كان clinic_id
-- الممرَّر بشكل صحيح يُستبدَل بـ NULL هنا قبل فحص القيد NOT NULL — بإثبات
-- مباشر (إدراج تجريبي بقيمة clinic_id صحيحة فشل بنفس الخطأ).
--
-- الإصلاح: احترام أي clinic_id مُمرَّر مسبقاً، والاعتماد على owner_id فقط
-- كخيار احتياطي عندما يكون NULL فعلاً.

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
