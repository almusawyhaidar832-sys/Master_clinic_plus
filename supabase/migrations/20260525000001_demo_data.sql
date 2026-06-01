-- Demo data for Master Clinic Plus (run after clinic seed + migrations)
-- Safe to re-run: uses fixed UUIDs and ON CONFLICT

INSERT INTO public.clinics (id, name, name_ar, phone, review_fee_enabled, review_fee_amount)
VALUES (
  'a0000000-0000-4000-8000-000000000001',
  'Master Clinic Plus',
  'ماستر كلينك بلس — تجريبي',
  '+201000000001',
  TRUE,
  50
)
ON CONFLICT (id) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  review_fee_enabled = EXCLUDED.review_fee_enabled,
  review_fee_amount = EXCLUDED.review_fee_amount;

SELECT public.seed_default_operation_types('a0000000-0000-4000-8000-000000000001');

INSERT INTO public.doctors (id, clinic_id, full_name_ar, specialty_ar, phone, percentage, materials_share, is_active)
VALUES
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'د. أحمد حسن', 'أسنان عام', '+201111111101', '50', '30', TRUE),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'د. سارة محمود', 'تقويم', '+201111111102', '60', '20', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.patients (id, clinic_id, full_name_ar, phone)
VALUES
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'محمد علي', '+201222222201'),
  ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'فاطمة إبراهيم', '+201222222202'),
  ('c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'يوسف كمال', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.patient_operations (
  id, clinic_id, patient_id, doctor_id, operation_name_ar,
  total_amount, paid_amount, materials_cost, operation_date
)
VALUES
  (
    'd0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    'c0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001',
    'حشوة تجميلية',
    1000, 800, 200, CURRENT_DATE
  ),
  (
    'd0000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000001',
    'c0000000-0000-4000-8000-000000000002',
    'b0000000-0000-4000-8000-000000000002',
    'تقويم — جلسة',
    2500, 2500, 400, CURRENT_DATE - 1
  ),
  (
    'd0000000-0000-4000-8000-000000000003',
    'a0000000-0000-4000-8000-000000000001',
    'c0000000-0000-4000-8000-000000000003',
    'b0000000-0000-4000-8000-000000000001',
    'خلع ضرس',
    600, 300, 50, CURRENT_DATE - 2
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.expenses (id, clinic_id, description_ar, amount, expense_date)
VALUES
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'مواد تعقيم', 450, CURRENT_DATE),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'فاتورة كهرباء', 1200, CURRENT_DATE - 5)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.staff_members (clinic_id, full_name_ar, job_title_ar, base_salary, slot_number)
SELECT
  'a0000000-0000-4000-8000-000000000001',
  'موظف ' || n,
  'مساعد',
  5000 + (n * 200),
  n
FROM generate_series(1, 7) AS n
WHERE NOT EXISTS (
  SELECT 1 FROM public.staff_members sm
  WHERE sm.clinic_id = 'a0000000-0000-4000-8000-000000000001'
    AND sm.slot_number = n
);

INSERT INTO public.appointments (
  id, clinic_id, doctor_id, patient_id, patient_name_ar, patient_phone,
  appointment_date, start_time, end_time, status
)
VALUES (
  'g0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001',
  'محمد علي',
  '+201222222201',
  CURRENT_DATE + 1,
  '10:00',
  '10:30',
  'scheduled'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.doctor_withdrawals (
  id, clinic_id, doctor_id, amount, status, source, notes
)
VALUES (
  'h0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001',
  200,
  'paid',
  'accountant_cash',
  'دفع نقدي تجريبي'
)
ON CONFLICT (id) DO NOTHING;
