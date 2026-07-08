-- يضمن وجود الأعمدة التي تسبّبت بخطأ:
-- "Could not find the 'created_by' column of 'expenses' in the schema cache"
-- آمن للتكرار (IF NOT EXISTS) ويُحدّث الـ schema cache في النهاية.

-- صرفيات العيادة العامة
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.expense_categories(id) ON DELETE SET NULL;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS expense_kind TEXT NOT NULL DEFAULT 'general';

-- فواتير صرفيات الأطباء
ALTER TABLE public.doctor_expenses
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.doctor_expenses
  ADD COLUMN IF NOT EXISTS invoice_storage_path TEXT;

ALTER TABLE public.doctor_expenses
  ADD COLUMN IF NOT EXISTS invoice_file_name TEXT;

ALTER TABLE public.doctor_expenses
  ADD COLUMN IF NOT EXISTS invoice_mime_type TEXT;

COMMENT ON COLUMN public.expenses.created_by IS 'المستخدم (المحاسب) الذي سجّل الصرفية';
COMMENT ON COLUMN public.doctor_expenses.created_by IS 'المستخدم (المحاسب) الذي سجّل فاتورة صرفية الطبيب';

-- إجبار PostgREST على إعادة تحميل السكيمة فوراً حتى لا يبقى الخطأ في الـ cache
NOTIFY pgrst, 'reload schema';
