/** Iraq mobile — used for WhatsApp and patient records */

export const IRAQ_COUNTRY_CODE = "964";

export function digitsOnly(input: string): string {
  return input.replace(/\D/g, "");
}

/**
 * E.164-style for WhatsApp API: +9647XXXXXXXX
 * - Strips spaces/dashes
 * - Local 07... → +9647...
 * - Missing country code → prepends 964
 */
export function normalizePhoneForWhatsApp(raw: string): string {
  let d = digitsOnly(raw.trim());
  if (!d) return "";

  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = `${IRAQ_COUNTRY_CODE}${d.slice(1)}`;
  else if (!d.startsWith(IRAQ_COUNTRY_CODE)) d = `${IRAQ_COUNTRY_CODE}${d}`;

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
      message: "رقم الهاتف غير صالح — تحقق من الرقم العراقي (مثال: 07XX XXX XXXX)",
    };
  }

  return { ok: true, normalized };
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
