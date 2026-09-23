-- =============================================================================
-- 71) إصلاح تضخّم patients.total_paid — حل جذري لكل العيادات
-- =============================================================================
-- السبب:
--   trigger trg_calculate_operation_shares يشتغل BEFORE INSERT OR UPDATE، وفي
--   فرع الدفعة/الخطة ينفّذ:
--       total_paid = total_paid + NEW.paid_amount
--   يعني كل تعديل على جلسة (ربط حالة، ملاحظة، تعديل مبلغ...) يضيف مبلغ الجلسة
--   مرة ثانية على المريض. والحذف ما يطرح شي. النتيجة: ذمم المرضى أصحاب الخطة
--   (agreed_total > 0) تطلع صفر رغم أنهم مديونين.
--
-- الحل (بدون تغيير أي حساب لحصة طبيب أو عيادة):
--   trigger جديد AFTER INSERT/UPDATE/DELETE يعيد total_paid = مجموع مدفوعات
--   جلسات المريض الفعلية — نفس المعادلة التي يستخدمها البرنامج عند تعديل
--   مبلغ جلسة (operation-amount-edit). ثم تصحيح البيانات الحالية مرة واحدة.
--
-- آمن للتشغيل أكثر من مرة.
-- =============================================================================

-- ── 0) معاينة قبل الإصلاح (للاطلاع فقط) ──────────────────────────────────────
SELECT
  c.name_ar                                   AS clinic,
  COUNT(*)                                    AS patients_with_plan,
  COUNT(*) FILTER (WHERE p.total_paid > s.real_paid + 0.01) AS inflated,
  COUNT(*) FILTER (WHERE p.total_paid < s.real_paid - 0.01) AS deflated,
  ROUND(SUM(p.total_paid - s.real_paid), 2)   AS phantom_paid_total
FROM public.patients p
JOIN public.clinics c ON c.id = p.clinic_id
CROSS JOIN LATERAL (
  SELECT GREATEST(0, COALESCE(SUM(o.paid_amount), 0)) AS real_paid
  FROM public.patient_operations o
  WHERE o.patient_id = p.id
) s
WHERE COALESCE(p.agreed_total, 0) > 0
GROUP BY c.name_ar
ORDER BY phantom_paid_total DESC;

BEGIN;

-- ── 1) دالة المزامنة ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_patient_total_paid_from_operations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids UUID[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_ids := ARRAY[OLD.patient_id];
  ELSIF TG_OP = 'UPDATE' THEN
    v_ids := ARRAY[NEW.patient_id, OLD.patient_id];
  ELSE
    v_ids := ARRAY[NEW.patient_id];
  END IF;

  UPDATE public.patients p
  SET total_paid = GREATEST(
    0,
    ROUND(
      COALESCE(
        (SELECT SUM(o.paid_amount)
         FROM public.patient_operations o
         WHERE o.patient_id = p.id),
        0
      ),
      2
    )
  )
  WHERE p.id = ANY (v_ids)
    AND p.id IS NOT NULL
    AND COALESCE(p.agreed_total, 0) > 0;

  RETURN NULL;
END;
$$;

-- الاسم يبدأ بـ zz حتى يشتغل بعد كل triggers الـ AFTER الأخرى (ترتيب أبجدي)
DROP TRIGGER IF EXISTS trg_zz_sync_patient_total_paid ON public.patient_operations;
CREATE TRIGGER trg_zz_sync_patient_total_paid
  AFTER INSERT OR UPDATE OR DELETE ON public.patient_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_patient_total_paid_from_operations();

-- ── 2) تصحيح البيانات الحالية مرة واحدة ─────────────────────────────────────
UPDATE public.patients p
SET total_paid = s.real_paid
FROM (
  SELECT
    p2.id,
    GREATEST(0, ROUND(COALESCE(SUM(o.paid_amount), 0), 2)) AS real_paid
  FROM public.patients p2
  LEFT JOIN public.patient_operations o ON o.patient_id = p2.id
  WHERE COALESCE(p2.agreed_total, 0) > 0
  GROUP BY p2.id
) s
WHERE p.id = s.id
  AND p.total_paid IS DISTINCT FROM s.real_paid;

COMMIT;

-- ── 3) تحقق بعد الإصلاح — لازم inflated = 0 و deflated = 0 ────────────────────
SELECT
  c.name_ar                                   AS clinic,
  COUNT(*)                                    AS patients_with_plan,
  COUNT(*) FILTER (WHERE p.total_paid > s.real_paid + 0.01) AS inflated,
  COUNT(*) FILTER (WHERE p.total_paid < s.real_paid - 0.01) AS deflated,
  ROUND(SUM(GREATEST(0, p.agreed_total - p.total_paid)), 2) AS outstanding_plan_debt
FROM public.patients p
JOIN public.clinics c ON c.id = p.clinic_id
CROSS JOIN LATERAL (
  SELECT GREATEST(0, COALESCE(SUM(o.paid_amount), 0)) AS real_paid
  FROM public.patient_operations o
  WHERE o.patient_id = p.id
) s
WHERE COALESCE(p.agreed_total, 0) > 0
GROUP BY c.name_ar
ORDER BY c.name_ar;
