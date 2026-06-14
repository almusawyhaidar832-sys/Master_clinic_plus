-- Schema Completeness Health Check — Master Clinic Plus
-- شغّله في Supabase → SQL Editor للتحقق من الجداول والأعمدة الأساسية
-- إذا ظهر ❌ ناقص → شغّل الملف في عمود fix_if_missing

SELECT
  check_name,
  CASE WHEN ok THEN '✅ OK' ELSE '❌ ناقص' END AS status,
  detail,
  CASE WHEN NOT ok THEN fix_script ELSE NULL END AS fix_if_missing
FROM (
  SELECT 'multi_tenant (clinics)' AS check_name,
    EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'clinics'
    ) AS ok,
    'جدول العيادات' AS detail,
    'supabase/scripts/APPLY_MULTI_TENANT_COMPLETE.sql' AS fix_script

  UNION ALL
  SELECT 'operation_tooth_records.status',
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'operation_tooth_records'
        AND column_name = 'status'
    ),
    'ألوان/حالة السن في المخطط',
    'supabase/scripts/41-operation-tooth-status.sql'

  UNION ALL
  SELECT 'patient_tooth_states',
    EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'patient_tooth_states'
    ),
    'مخطط المريض التراكمي',
    'supabase/scripts/30-patient-tooth-states.sql'

  UNION ALL
  SELECT 'patient_treatment_cases',
    EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'patient_treatment_cases'
    ),
    'حالات العلاج متعددة الجلسات',
    'supabase/migrations/20260603160000_patient_treatment_cases.sql'

  UNION ALL
  SELECT 'patient_prescriptions',
    EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'patient_prescriptions'
    ),
    'الوصفات',
    'supabase/scripts/33-patient-prescriptions.sql'

  UNION ALL
  SELECT 'operation_xray_images',
    EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'operation_xray_images'
    ),
    'أشعة الجلسة',
    'supabase/migrations/20260603100000_clinical_session_records.sql'

  UNION ALL
  -- الربط الصحيح: patient_operations.queue_entry_id → patient_queue.id
  SELECT 'visit_session (queue_entry_id)',
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'patient_operations'
        AND column_name = 'queue_entry_id'
    ),
    'ربط الطابور بالجلسة',
    'supabase/scripts/32-visit-session-operation.sql'

  UNION ALL
  SELECT 'queue ready_for_billing',
    EXISTS (
      SELECT 1 FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'queue_status' AND e.enumlabel = 'ready_for_billing'
    ),
    'إرسال للمحاسبة',
    'supabase/scripts/31-ready-for-billing.sql'

  UNION ALL
  SELECT 'queue cancellation_requested_at',
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'patient_queue'
        AND column_name = 'cancellation_requested_at'
    ),
    'طلب إلغاء من الطبيب/المساعد',
    'supabase/scripts/42-queue-cancellation-request.sql'

  UNION ALL
  SELECT 'push_subscriptions',
    EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'push_subscriptions'
    ),
    'إشعارات PWA',
    'supabase/scripts/40-push-subscriptions.sql'

) checks
ORDER BY check_name;
