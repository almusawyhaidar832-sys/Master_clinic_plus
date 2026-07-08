-- السماح بدفع أكبر من إجمالي الفاتورة (دفعة زائدة / خصم لاحق)
ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_paid_not_exceed_total;

COMMENT ON COLUMN public.invoices.remaining_amount IS
  'المتبقي = الإجمالي − المدفوع (قد يكون سالباً عند دفعة زائدة)';
