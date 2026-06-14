-- =============================================================================
-- Financial Health Check — Master Clinic Plus
-- شغّله في Supabase → SQL Editor
--
-- طريقة الاستخدام:
--   • شغّل كل «مرحلة» لوحدها (حدّد البلوك → Run)
--   • أو شغّل الملف كامل — Supabase يعرض نتيجة آخر استعلام فقط
--
-- ترتيب الإصلاح إذا ظهر ❌ في المرحلة 0:
--   09 → fix-salary-month-closures → 37 (مو 36) → 38 → 18 → 21 → 25 → 26
-- =============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- مرحلة 0 — البنية (جداول + أعمدة + دوال)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  check_name,
  CASE WHEN ok THEN '✅ OK' ELSE '❌ ناقص' END AS status,
  detail,
  CASE WHEN NOT ok THEN fix_script ELSE NULL END AS fix_if_missing
FROM (
  SELECT 'table: patient_treatment_cases' AS check_name,
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'patient_treatment_cases') AS ok,
    'حالات العلاج' AS detail,
    'migrations/20260603160000_patient_treatment_cases.sql' AS fix_script
  UNION ALL SELECT 'table: patient_operations',
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'patient_operations'),
    'جلسات/دفعات', 'initial_schema'
  UNION ALL SELECT 'table: doctor_withdrawals',
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'doctor_withdrawals'),
    'سحوبات الطبيب', 'initial_schema'
  UNION ALL SELECT 'table: expenses',
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'expenses'),
    'مصروفات', 'initial_schema'
  UNION ALL SELECT 'table: transactions',
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'transactions'),
    'حركات مالية', '09-payroll-accounting-complete.sql'
  UNION ALL SELECT 'table: salary_slips',
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'salary_slips'),
    'قسائم رواتب', '09-payroll-accounting-complete.sql'
  UNION ALL SELECT 'table: salary_entries',
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'salary_entries'),
    'سلف/خصم/مكافأة', '09-payroll-accounting-complete.sql'
  UNION ALL SELECT 'table: payroll_records',
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payroll_records'),
    'رواتب مساعدين', '09-payroll-accounting-complete.sql'
  UNION ALL SELECT 'table: salary_month_closures',
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'salary_month_closures'),
    'تصفير لوحة الرواتب', 'fix-salary-month-closures.sql'
  UNION ALL SELECT 'table: invoices_history',
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'invoices_history'),
    'سجل الفواتير', '25-invoices-history.sql'
  UNION ALL SELECT 'table: session_refunds',
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'session_refunds'),
    'استردادات', 'migrations/20260609000000_session_refunds.sql'
  UNION ALL SELECT 'col: doctor_share_amount',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'patient_operations' AND column_name = 'doctor_share_amount'),
    'حصة مجمدة لكل دفعة', '38-freeze-doctor-share-on-payment.sql'
  UNION ALL SELECT 'col: clinic_share_amount',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'patient_operations' AND column_name = 'clinic_share_amount'),
    'حصة العيادة لكل دفعة', '38-freeze-doctor-share-on-payment.sql'
  UNION ALL SELECT 'col: review_fee_amount',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'patient_operations' AND column_name = 'review_fee_amount'),
    'كشفية', '38-freeze-doctor-share-on-payment.sql'
  UNION ALL SELECT 'col: salary_slips.doctor_id',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'salary_slips' AND column_name = 'doctor_id'),
    'راتب طبيب ثابت', '37-salary-entry-doctor.sql'
  UNION ALL SELECT 'col: salary_entries.doctor_id',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'salary_entries' AND column_name = 'doctor_id'),
    'سلف طبيب راتب', '37-salary-entry-doctor.sql'
  UNION ALL SELECT 'col: salary_entries.assistant_id',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'salary_entries' AND column_name = 'assistant_id'),
    'سلف مساعد', '37-salary-entry-doctor.sql'
  UNION ALL SELECT 'fn: calculate_operation_shares',
    EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'calculate_operation_shares'),
    'trigger الحصص', '38-freeze-doctor-share-on-payment.sql'
  UNION ALL SELECT 'fn: calc_doctor_operation_earned',
    EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'calc_doctor_operation_earned'),
    'أرباح محفظة الطبيب', '38-freeze-doctor-share-on-payment.sql'
  UNION ALL SELECT 'fn: calc_clinic_operation_earned',
    EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'calc_clinic_operation_earned'),
    'ربح العيادة من الجلسات', '18-fix-accounting-consistency.sql'
  UNION ALL SELECT 'fn: get_doctor_wallet_stats',
    EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'get_doctor_wallet_stats'),
    'إحصائيات المحفظة', '18-fix-accounting-consistency.sql'
  UNION ALL SELECT 'fn: get_clinic_financial_snapshot',
    EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'get_clinic_financial_snapshot'),
    'لوحة الأرباح', '21-fix-doctor-percentage-cast.sql'
  UNION ALL SELECT 'trg: trg_calculate_operation_shares',
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_calculate_operation_shares'),
    'حساب تلقائي عند الحفظ', '38-freeze-doctor-share-on-payment.sql'
  UNION ALL SELECT 'constraint: salary_entries_person_check',
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'salary_entries_person_check'),
    'موظف OR مساعد OR طبيب', '37-salary-entry-doctor.sql'
) AS t(check_name, ok, detail, fix_script)
ORDER BY check_name;


-- ═══════════════════════════════════════════════════════════════════════════
-- مرحلة IDs — كل العيادات والأطباء (مو عيادة واحدة)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  c.id AS clinic_id,
  c.name_ar AS clinic_name,
  d.id AS doctor_id,
  d.full_name_ar AS doctor_name,
  d.percentage,
  d.payment_type
FROM public.clinics c
LEFT JOIN public.doctors d ON d.clinic_id = c.id
ORDER BY c.name_ar, d.full_name_ar;


-- ═══════════════════════════════════════════════════════════════════════════
-- مرحلة 1أ — الأطباء ونسبهم
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  c.name_ar AS clinic_name,
  d.id,
  d.full_name_ar,
  d.percentage,
  d.materials_share,
  d.payment_type,
  d.salary_amount
FROM public.doctors d
JOIN public.clinics c ON c.id = d.clinic_id
ORDER BY c.name_ar, d.full_name_ar;


-- ═══════════════════════════════════════════════════════════════════════════
-- مرحلة 1ب — جلسات بدون حصة مجمدة (المفروض 0 أو قليل)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  c.name_ar AS clinic_name,
  COUNT(*) AS ops_missing_share
FROM public.patient_operations po
JOIN public.clinics c ON c.id = po.clinic_id
WHERE COALESCE(po.paid_amount, 0) > 0
  AND COALESCE(po.doctor_share_amount, 0) = 0
  AND COALESCE(po.clinic_share_amount, 0) = 0
  AND COALESCE(po.session_kind, '') <> 'refund'
GROUP BY c.name_ar
ORDER BY c.name_ar;


-- ═══════════════════════════════════════════════════════════════════════════
-- مرحلة 1ج — فرق الحصة (diff) — لكل عيادة
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  c.name_ar AS clinic_name,
  COUNT(*) AS rows_checked,
  COUNT(*) FILTER (WHERE ABS(
    COALESCE(po.doctor_share_amount, 0)
    - ROUND(po.paid_amount * ptc.doctor_share_total / NULLIF(ptc.final_price, 0), 2)
  ) > 1) AS rows_with_diff_over_1_dinar
FROM public.patient_operations po
JOIN public.patient_treatment_cases ptc ON ptc.id = po.treatment_case_id
JOIN public.doctors d ON d.id = po.doctor_id
JOIN public.clinics c ON c.id = po.clinic_id
WHERE COALESCE(po.paid_amount, 0) > 0
  AND COALESCE(ptc.final_price, 0) > 0
  AND COALESCE(ptc.doctor_share_total, 0) > 0
  AND COALESCE(d.payment_type, 'percentage') <> 'salary'
  AND COALESCE(po.session_kind, '') = 'payment'
GROUP BY c.name_ar
ORDER BY c.name_ar;


-- ═══════════════════════════════════════════════════════════════════════════
-- مرحلة 2 — محفظة كل طبيب «نسبة» (مو راتب)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  c.name_ar AS clinic_name,
  d.full_name_ar AS doctor_name,
  d.id AS doctor_id,
  public.get_doctor_wallet_stats(d.id) AS wallet_json
FROM public.doctors d
JOIN public.clinics c ON c.id = d.clinic_id
WHERE COALESCE(d.payment_type, 'percentage') <> 'salary'
ORDER BY c.name_ar, d.full_name_ar;


-- ═══════════════════════════════════════════════════════════════════════════
-- مرحلة 3 — snapshot لوحة الأرباح — كل العيادات (الأمل + جونيور + ...)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  c.name_ar AS clinic_name,
  c.id AS clinic_id,
  public.get_clinic_financial_snapshot(
    c.id,
    DATE_TRUNC('month', CURRENT_DATE)::date,
    CURRENT_DATE
  ) AS snapshot_json
FROM public.clinics c
ORDER BY c.name_ar;


-- ═══════════════════════════════════════════════════════════════════════════
-- مرحلة 3 (عيادة واحدة) — بدّل الاسم إذا تريد
-- ═══════════════════════════════════════════════════════════════════════════
-- SELECT
--   c.name_ar,
--   c.id AS clinic_id,
--   public.get_clinic_financial_snapshot(
--     c.id,
--     DATE_TRUNC('month', CURRENT_DATE)::date,
--     CURRENT_DATE
--   ) AS snapshot_json
-- FROM public.clinics c
-- WHERE c.name_ar ILIKE '%الامل%'
--    OR c.name_ar ILIKE '%امل%';


-- ═══════════════════════════════════════════════════════════════════════════
-- مرحلة 4أ — مصروفات الشهر — لكل عيادة
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  c.name_ar AS clinic_name,
  COUNT(e.id) AS expense_count,
  COALESCE(SUM(e.amount), 0) AS total_expenses
FROM public.clinics c
LEFT JOIN public.expenses e
  ON e.clinic_id = c.id
  AND e.expense_date >= DATE_TRUNC('month', CURRENT_DATE)::date
GROUP BY c.id, c.name_ar
ORDER BY c.name_ar;


-- ═══════════════════════════════════════════════════════════════════════════
-- مرحلة 4ب — حركات transactions — لكل عيادة (إن الجدول موجود)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  c.name_ar AS clinic_name,
  t.type,
  COUNT(*) AS row_count,
  COALESCE(SUM(t.amount), 0) AS total_amount
FROM public.clinics c
LEFT JOIN public.transactions t
  ON t.clinic_id = c.id
  AND t.transaction_date >= DATE_TRUNC('month', CURRENT_DATE)::date
GROUP BY c.name_ar, t.type
HAVING COUNT(t.id) > 0
ORDER BY c.name_ar, t.type;


-- ═══════════════════════════════════════════════════════════════════════════
-- مرحلة 5 — فواتير — لكل عيادة
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  c.name_ar AS clinic_name,
  COUNT(ih.id) AS invoice_count,
  COALESCE(SUM(ih.paid_amount), 0) AS total_paid,
  COALESCE(SUM(ih.doctor_share), 0) AS total_doctor_share,
  COALESCE(SUM(ih.clinic_share), 0) AS total_clinic_share
FROM public.clinics c
LEFT JOIN public.invoices_history ih
  ON ih.clinic_id = c.id
  AND ih.invoice_date >= DATE_TRUNC('month', CURRENT_DATE)::date
GROUP BY c.id, c.name_ar
ORDER BY c.name_ar;


-- ═══════════════════════════════════════════════════════════════════════════
-- مرحلة 6أ — مساعدون + نسبة تقسيم الراتب
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  c.name_ar AS clinic_name,
  a.full_name_ar AS assistant_name,
  a.total_salary,
  a.doctor_share_percentage,
  d.full_name_ar AS doctor_name
FROM public.assistants a
JOIN public.doctors d ON d.id = a.doctor_id
JOIN public.clinics c ON c.id = a.clinic_id
ORDER BY c.name_ar, a.full_name_ar;


-- ═══════════════════════════════════════════════════════════════════════════
-- مرحلة 6ب — قسائم الشهر — لكل عيادة
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  c.name_ar AS clinic_name,
  ss.month_year,
  ss.status,
  CASE
    WHEN ss.staff_id IS NOT NULL THEN 'موظف'
    WHEN ss.doctor_id IS NOT NULL THEN 'طبيب راتب'
    ELSE 'غير محدد'
  END AS slip_kind,
  ss.base_salary,
  ss.net_payout
FROM public.salary_slips ss
JOIN public.clinics c ON c.id = ss.clinic_id
WHERE ss.month_year = TO_CHAR(CURRENT_DATE, 'YYYY-MM')
ORDER BY c.name_ar, slip_kind;


-- ═══════════════════════════════════════════════════════════════════════════
-- مرحلة 6ج — رواتب مساعدين — الشهر الحالي
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  c.name_ar AS clinic_name,
  pr.assistant_name_ar,
  pr.doctor_name_ar,
  pr.status,
  pr.total_salary,
  pr.doctor_share_amount,
  pr.clinic_share_amount
FROM public.payroll_records pr
JOIN public.clinics c ON c.id = pr.clinic_id
WHERE pr.month_year = TO_CHAR(CURRENT_DATE, 'YYYY-MM')
ORDER BY c.name_ar, pr.assistant_name_ar;


-- ═══════════════════════════════════════════════════════════════════════════
-- مرحلة 6د — salary_entries مخالفة للقيد (المفروض 0)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT COUNT(*) AS bad_salary_entry_rows
FROM public.salary_entries se
WHERE NOT (
  (se.staff_id IS NOT NULL AND se.assistant_id IS NULL AND se.doctor_id IS NULL)
  OR (se.staff_id IS NULL AND se.assistant_id IS NOT NULL AND se.doctor_id IS NULL)
  OR (se.staff_id IS NULL AND se.assistant_id IS NULL AND se.doctor_id IS NOT NULL)
);
