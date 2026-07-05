/** Iraq mobile — used for WhatsApp and patient records */

import type { SupabaseClient } from "@supabase/supabase-js";

export const IRAQ_COUNTRY_CODE = "964";

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const ARABIC_EASTERN = "۰۱۲۳۴۵۶۷۸۹";

/** تحويل الأرقام العربية/فارسية إلى إنجليزية */
export function toWesternDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (ch) => String(ARABIC_INDIC.indexOf(ch)))
    .replace(/[۰-۹]/g, (ch) => String(ARABIC_EASTERN.indexOf(ch)));
}

export function digitsOnly(input: string): string {
  return toWesternDigits(input).replace(/\D/g, "");
}

/** عرض محلي في النماذج: +9647801234567 → 07801234567 */
export function phoneToLocalDisplay(phone: string | null | undefined): string {
  if (!phone?.trim()) return "";
  let d = digitsOnly(phone);
  if (d.startsWith("964")) d = `0${d.slice(3)}`;
  return d;
}

/**
 * أثناء الكتابة — أرقام فقط، يبدأ بـ 07 (078 / 077 …).
 * إذا بدأ المستخدم بـ 7 بدون 0 نضيف 0 تلقائياً.
 */
export function sanitizePatientPhoneInput(raw: string): string {
  let d = digitsOnly(raw);
  if (!d) return "";
  if (d.startsWith("964")) d = `0${d.slice(3)}`;
  if (d[0] === "7" && !d.startsWith("0")) d = `0${d}`;
  return d.slice(0, 11);
}

/**
 * E.164-style for WhatsApp API: +9647XXXXXXXX
 * - يزيل المسافات والأصفار الزائدة
 * - 07... → +9647...
 * - يتحقق أن الرقم عراقي صالح
 */
export function normalizePhoneForWhatsApp(raw: string): string {
  let d = digitsOnly(String(raw ?? "").trim());
  if (!d) return "";

  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("9640")) d = `964${d.slice(4)}`;
  if (d.startsWith("0")) d = `${IRAQ_COUNTRY_CODE}${d.slice(1)}`;
  else if (!d.startsWith(IRAQ_COUNTRY_CODE)) d = `${IRAQ_COUNTRY_CODE}${d}`;

  const national = d.slice(IRAQ_COUNTRY_CODE.length);
  if (!national.startsWith("7") || national.length < 9 || national.length > 10) {
    return "";
  }

  if (d.length < 12 || d.length > 13) return "";

  return `+${d}`;
}

export function validatePatientPhone(raw: string): {
  ok: true;
  normalized: string;
} | {
  ok: false;
  message: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, message: "أدخل رقم هاتف المراجع" };
  }

  const d = digitsOnly(trimmed);
  if (d.length < 10) {
    return {
      ok: false,
      message: "رقم الهاتف غير صالح — يجب أن لا يقل عن 10 أرقام",
    };
  }

  const normalized = normalizePhoneForWhatsApp(trimmed);
  const national = digitsOnly(normalized).slice(IRAQ_COUNTRY_CODE.length);
  if (national.length < 9 || national.length > 11) {
    return {
      ok: false,
      message:
        "رقم الهاتف غير صالح — استخدم 078 أو 077 (مثال: 07801234567)",
    };
  }

  return { ok: true, normalized };
}

/** رقم اختياري — فارغ OK، وإلا يُ normalizes إلى +964 */
export function normalizeOptionalPatientPhone(raw?: string | null):
  | { ok: true; phone: string | null }
  | { ok: false; message: string } {
  const trimmed = raw?.trim();
  if (!trimmed) return { ok: true, phone: null };
  const check = validatePatientPhone(trimmed);
  if (!check.ok) return { ok: false, message: check.message };
  return { ok: true, phone: check.normalized };
}

/** Columns written on insert/update — keeps legacy `phone` in sync */
export function patientPhoneColumns(normalized: string): {
  phone: string;
  phone_number: string;
} {
  return { phone: normalized, phone_number: normalized };
}

export function getPatientDisplayPhone(patient: {
  phone?: string | null;
  phone_number?: string | null;
}): string | null {
  return patient.phone_number ?? patient.phone ?? null;
}

/** حفظ رقم المراجع قبل إرسال واتساب — يُحدّث السجل إن وُجد رقم في النموذج */
export async function ensurePatientPhoneOnRecord(
  supabase: SupabaseClient,
  patientId: string,
  formPhone: string
): Promise<
  | { ok: true; phone: string }
  | { ok: false; reason: "missing" | "invalid"; message: string }
> {
  const trimmed = formPhone.trim();

  if (trimmed) {
    const check = validatePatientPhone(trimmed);
    if (!check.ok) {
      return { ok: false, reason: "invalid", message: check.message };
    }
    const { error } = await supabase
      .from("patients")
      .update(patientPhoneColumns(check.normalized))
      .eq("id", patientId);
    if (error) {
      return {
        ok: false,
        reason: "invalid",
        message: error.message || "تعذر حفظ رقم الهاتف",
      };
    }
    return { ok: true, phone: check.normalized };
  }

  const { data } = await supabase
    .from("patients")
    .select("phone, phone_number")
    .eq("id", patientId)
    .maybeSingle();

  const existing = getPatientDisplayPhone(data ?? {});
  if (existing?.trim()) {
    return { ok: true, phone: existing.trim() };
  }

  return {
    ok: false,
    reason: "missing",
    message: "أدخل رقم جوال المراجع لإرسال واتساب تلقائياً",
  };
}
