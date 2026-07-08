-- السماح بدفع أكبر من إجمالي الفاتورة (دفعة زائدة)
-- شغّله في Supabase SQL Editor إذا لم تُطبَّق migration 20260708150000

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_paid_not_exceed_total;
