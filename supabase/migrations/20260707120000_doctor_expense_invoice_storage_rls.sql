-- Storage RLS for doctor expense invoice attachments (bucket created in 20260613000000)

DROP POLICY IF EXISTS doctor_expense_invoices_select ON storage.objects;
CREATE POLICY doctor_expense_invoices_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'doctor-expense-invoices'
    AND public.tenant_can_access(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS doctor_expense_invoices_insert ON storage.objects;
CREATE POLICY doctor_expense_invoices_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'doctor-expense-invoices'
    AND public.tenant_can_access(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS doctor_expense_invoices_delete ON storage.objects;
CREATE POLICY doctor_expense_invoices_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'doctor-expense-invoices'
    AND public.tenant_can_access(((storage.foldername(name))[1])::uuid)
  );

-- invoice-xrays bucket (uploads via service role; SELECT/DELETE for clinic staff)
DROP POLICY IF EXISTS invoice_xrays_select ON storage.objects;
CREATE POLICY invoice_xrays_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'invoice-xrays'
    AND public.tenant_can_access(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS invoice_xrays_delete ON storage.objects;
CREATE POLICY invoice_xrays_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'invoice-xrays'
    AND public.tenant_can_access(((storage.foldername(name))[1])::uuid)
  );
