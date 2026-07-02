-- إصلاح ازدواجية الدفع بتأكيد الرواتب (payroll confirm)
--
-- المشكلة: confirmReference() بكود التطبيق كانت تُنشئ معرّفاً فريداً بكل
-- استدعاء (`${parentId}:${Date.now()}`) — فحص منع التكرار بـ
-- recordFinancialTransaction (SELECT ثم INSERT بدون قفل) لا يطابق أبداً،
-- وضغطتان متزامنتان (أو إعادة محاولة الشبكة) على "تأكيد الراتب" تنتجان
-- معاملتين ماليتين منفصلتين بخصم مضاعف.
--
-- الإصلاح على جانب التطبيق (src/lib/services/payroll-financial.ts):
-- المرجع أصبح مبنياً على المبلغ المدفوع *قبل* التأكيد (ثابت وليس زمنياً)،
-- فطلبان متزامنان لنفس عملية التأكيد ينتجان نفس المرجع بالضبط.
-- هذا القيد هنا هو خط الدفاع الحقيقي على مستوى قاعدة البيانات: حتى لو
-- تجاوز طلبان فحص "هل هذا المرجع موجود؟" في نفس اللحظة (TOCTOU)، فالقيد
-- يمنع إدراج الصف الثاني فعلياً، ويتعامل معه الكود كنجاح متجاوَز.

CREATE UNIQUE INDEX IF NOT EXISTS transactions_clinic_reference_unique
  ON public.transactions (clinic_id, reference_type, reference_id)
  WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
