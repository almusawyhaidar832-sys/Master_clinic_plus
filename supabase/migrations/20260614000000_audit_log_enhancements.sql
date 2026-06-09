-- Audit log: financial_amount + actor_name for manager activity feed

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS financial_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS actor_name TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_logs_action
  ON public.audit_logs (clinic_id, action, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_changed_by
  ON public.audit_logs (clinic_id, changed_by, changed_at DESC);

COMMENT ON COLUMN public.audit_logs.financial_amount IS 'المبلغ المالي المتأثر (موجب=إيراد، سالب=مرتجع/خصم)';
COMMENT ON COLUMN public.audit_logs.actor_name IS 'اسم المستخدم وقت التسجيل';
