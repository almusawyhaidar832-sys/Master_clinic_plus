/** Map Postgres / Supabase errors to localized messages for the UI */
import type { Language } from "@/i18n/translations";

const ERROR_MAP: Array<{
  match: (m: string) => boolean;
  ar: string;
  en: string;
}> = [
  {
    match: (m) => m.includes("withdrawal_exceeds_balance"),
    ar: "المبلغ أكبر من رصيد الطبيب المتاح",
    en: "Amount exceeds doctor's available balance",
  },
  {
    match: (m) => m.includes("access denied"),
    ar: "غير مصرح — تأكد من ربط حسابك بالعيادة",
    en: "Access denied — make sure your account is linked to a clinic",
  },
  {
    match: (m) => m.includes("clinic_id required"),
    ar: "حسابك غير مربوط بعيادة — أعد تسجيل الدخول بعد ربط العيادة",
    en: "Your account is not linked to a clinic — sign in again after linking",
  },
  {
    match: (m) => m.includes("relation") && m.includes("patient_queue"),
    ar: "جدول غرفة الانتظار غير موجود — شغّل APPLY_ALL_FIXES.sql في Supabase",
    en: "Waiting room table missing — run APPLY_ALL_FIXES.sql in Supabase",
  },
  {
    match: (m) => m.includes("permission denied") || m.includes("policy"),
    ar: "صلاحيات غير كافية — سجّل دخولك كمحاسب أو مدير",
    en: "Insufficient permissions — sign in as accountant or admin",
  },
  {
    match: (m) =>
      m.includes("salary_entry_type") ||
      m.includes("invalid input value for enum"),
    ar: "نوع الحركة غير مدعوم — شغّل supabase/scripts/35-salary-entry-bonus.sql في Supabase",
    en: "Transaction type not supported — run supabase/scripts/35-salary-entry-bonus.sql in Supabase",
  },
  {
    match: (m) => m.includes("patients_total_paid_check"),
    ar: "تعذر الإرجاع — المبلغ يتجاوز المدفوع المسجّل للمراجع",
    en: "Refund failed — amount exceeds recorded patient payments",
  },
  {
    match: (m) =>
      m.includes("appointments_no_doctor_overlap") ||
      (m.includes("exclusion constraint") && m.includes("appointments")),
    ar: "هذا الموعد محجوز مسبقاً — اختر وقتاً آخر",
    en: "This time slot is already booked — choose another time",
  },
  {
    match: (m) => m.includes("failed to fetch") || m.includes("networkerror"),
    ar: "تعذر الاتصال بالخادم — تحقق من الإنترنت أو إعدادات Supabase في .env.local",
    en: "Cannot connect to server — check internet or Supabase settings in .env.local",
  },
];

export function translateDbError(message: string, lang: Language = "ar"): string {
  const m = message.toLowerCase();
  for (const entry of ERROR_MAP) {
    if (entry.match(m)) {
      return lang === "en" ? entry.en : entry.ar;
    }
  }
  return message;
}
