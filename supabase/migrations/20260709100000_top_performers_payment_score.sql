-- أفضل الأطباء: الترتيب حسب مدفوعات المراجعين (paid_amount) وليس إجمالي الجلسات

CREATE OR REPLACE FUNCTION public.get_top_performers(
  p_clinic_id UUID,
  p_from DATE DEFAULT DATE_TRUNC('month', CURRENT_DATE)::DATE,
  p_to   DATE DEFAULT CURRENT_DATE
)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_clinic_id        UUID;
  v_top_doctors      JSON;
  v_top_services     JSON;
  v_top_expenses     JSON;
  v_inactive_doctors JSON;
BEGIN
  v_clinic_id := public.get_my_clinic_id();
  IF v_clinic_id IS NULL AND public.is_platform_admin() AND p_clinic_id IS NOT NULL THEN
    v_clinic_id := p_clinic_id;
  ELSIF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'access_denied';
  ELSIF p_clinic_id IS NOT NULL AND p_clinic_id <> v_clinic_id AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  SELECT json_agg(row_to_json(d)) INTO v_top_doctors FROM (
    SELECT
      doc.id::TEXT                                    AS doctor_id,
      doc.full_name_ar,
      ROUND(COALESCE(SUM(
        CASE WHEN COALESCE(po.paid_amount, 0) > 0 THEN po.paid_amount ELSE 0 END
      ), 0)::NUMERIC, 2)                              AS collected,
      COUNT(*) FILTER (WHERE COALESCE(po.paid_amount, 0) > 0)::INT AS payment_count,
      ROUND(COALESCE(SUM(po.total_amount), 0)::NUMERIC, 2)         AS revenue,
      ROUND(COALESCE(SUM(po.clinic_share_amount), 0)::NUMERIC, 2) AS clinic_share,
      ROUND(COALESCE(SUM(po.doctor_share_amount), 0)::NUMERIC, 2) AS doctor_share,
      COUNT(*)::INT                                   AS op_count
    FROM public.patient_operations po
    JOIN public.doctors doc
      ON doc.id = po.doctor_id
     AND doc.clinic_id = v_clinic_id
    WHERE po.clinic_id = v_clinic_id
      AND po.operation_date BETWEEN p_from AND p_to
    GROUP BY doc.id, doc.full_name_ar
    ORDER BY collected DESC, payment_count DESC, op_count DESC
  ) d;

  SELECT json_agg(row_to_json(s)) INTO v_top_services FROM (
    SELECT
      po.operation_name_ar                          AS service_name,
      COUNT(*)                                      AS count,
      ROUND(SUM(po.total_amount)::NUMERIC, 2)       AS revenue,
      ROUND(AVG(po.total_amount)::NUMERIC, 2)       AS avg_price,
      ROUND(AVG(CASE WHEN po.total_amount > 0
        THEN (po.clinic_share_amount / po.total_amount) * 100
        ELSE 0 END)::NUMERIC, 1)                    AS clinic_margin_pct
    FROM public.patient_operations po
    WHERE po.clinic_id = v_clinic_id
      AND po.operation_date BETWEEN p_from AND p_to
    GROUP BY po.operation_name_ar
    ORDER BY revenue DESC
    LIMIT 5
  ) s;

  SELECT json_agg(row_to_json(e)) INTO v_top_expenses FROM (
    SELECT
      COALESCE(ec.name_ar, 'غير مصنف') AS category,
      ROUND(SUM(ex.amount)::NUMERIC, 2) AS total,
      COUNT(*)                          AS count
    FROM public.expenses ex
    LEFT JOIN public.expense_categories ec ON ec.id = ex.category_id
    WHERE ex.clinic_id = v_clinic_id
      AND ex.expense_date BETWEEN p_from AND p_to
      AND COALESCE(ex.expense_kind, 'general') <> 'doctor_salary'
    GROUP BY ec.name_ar
    ORDER BY total DESC
    LIMIT 5
  ) e;

  SELECT json_agg(row_to_json(i) ORDER BY i.full_name_ar) INTO v_inactive_doctors FROM (
    SELECT doc.id::TEXT AS doctor_id, doc.full_name_ar
    FROM public.doctors doc
    WHERE doc.clinic_id = v_clinic_id
      AND doc.is_active = true
      AND NOT EXISTS (
        SELECT 1
        FROM public.patient_operations po
        WHERE po.doctor_id = doc.id
          AND po.clinic_id = v_clinic_id
          AND po.operation_date BETWEEN p_from AND p_to
          AND COALESCE(po.paid_amount, 0) > 0
      )
  ) i;

  RETURN json_build_object(
    'top_doctors',      COALESCE(v_top_doctors,      '[]'::JSON),
    'top_services',     COALESCE(v_top_services,     '[]'::JSON),
    'top_expenses',     COALESCE(v_top_expenses,     '[]'::JSON),
    'inactive_doctors', COALESCE(v_inactive_doctors, '[]'::JSON)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_top_performers(UUID, DATE, DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';
