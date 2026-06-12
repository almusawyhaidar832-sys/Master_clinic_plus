/** Map Postgres / Supabase errors to Arabic messages for the UI */
export function translateDbError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("withdrawal_exceeds_balance")) {
    return "المبلغ أكبر من رصيد الطبيب المتاح";
  }
  if (m.includes("access denied")) {
    return "غير مصرح — تأكد من ربط حسابك بالعيادة";
  }
  if (m.includes("clinic_id required")) {
    return "حسابك غير مربوط بعيادة — أعد تسجيل الدخول بعد ربط العيادة";
  }
  if (m.includes("relation") && m.includes("patient_queue")) {
    return "جدول غرفة الانتظار غير موجود — شغّل APPLY_ALL_FIXES.sql في Supabase";
  }
  if (m.includes("permission denied") || m.includes("policy")) {
    return "صلاحيات غير كافية — سجّل دخولك كمحاسب أو مدير";
  }
  if (
    m.includes("salary_entry_type") ||
    m.includes("invalid input value for enum")
  ) {
    return "نوع الحركة غير مدعوم — شغّل supabase/scripts/35-salary-entry-bonus.sql في Supabase";
  }
  if (m.includes("patients_total_paid_check")) {
    return "تعذر الإرجاع — المبلغ يتجاوز المدفوع المسجّل للمراجع";
  }
  if (m.includes("failed to fetch") || m.includes("networkerror")) {
    return "تعذر الاتصال بالخادم — تحقق من الإنترنت أو إعدادات Supabase في .env.local";
  }
  return message;
}
