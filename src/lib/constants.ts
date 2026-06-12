/** Fixed dropdown options — no free-text for doctor agreements */

const pct = (n: number) => ({ value: String(n), label: `${n}%` }) as const;

export const DOCTOR_PERCENTAGE_OPTIONS = [
  pct(10),
  pct(20),
  pct(30),
  pct(40),
  pct(50),
  pct(60),
  pct(70),
  pct(80),
  pct(90),
  pct(100),
] as const;

export const MATERIALS_SHARE_OPTIONS = [
  { value: "0", label: "0% — على العيادة بالكامل" },
  pct(10),
  pct(20),
  pct(30),
  pct(40),
  { value: "50", label: "50% — تقسيم مناصفة" },
  pct(60),
  pct(70),
  pct(80),
  pct(90),
  { value: "100", label: "100% — على الطبيب بالكامل" },
] as const;

export const VALID_DOCTOR_PERCENTAGE_VALUES = DOCTOR_PERCENTAGE_OPTIONS.map(
  (o) => o.value
);

export const VALID_MATERIALS_SHARE_VALUES = MATERIALS_SHARE_OPTIONS.map(
  (o) => o.value
);

export function normalizeDoctorPercentage(
  value: unknown,
  fallback = "50"
): string {
  const s = String(value ?? "").trim();
  return (VALID_DOCTOR_PERCENTAGE_VALUES as readonly string[]).includes(s)
    ? s
    : fallback;
}

export function parseDoctorPercentageStrict(
  value: unknown
): { ok: true; value: string } | { ok: false; error: string } {
  const s = String(value ?? "").trim();
  if (!(VALID_DOCTOR_PERCENTAGE_VALUES as readonly string[]).includes(s)) {
    return {
      ok: false,
      error: "نسبة الطبيب يجب أن تكون 10% أو 20% … حتى 100% (مضاعفات 10 فقط)",
    };
  }
  return { ok: true, value: s };
}

export function normalizeMaterialsShare(
  value: unknown,
  fallback = "0"
): string {
  const s = String(value ?? "").trim();
  return (VALID_MATERIALS_SHARE_VALUES as readonly string[]).includes(s)
    ? s
    : fallback;
}

export function parseMaterialsShareStrict(
  value: unknown
): { ok: true; value: string } | { ok: false; error: string } {
  const s = String(value ?? "").trim();
  if (!(VALID_MATERIALS_SHARE_VALUES as readonly string[]).includes(s)) {
    return {
      ok: false,
      error: "نسبة تحمّل المختبر غير صالحة — اختر من القائمة",
    };
  }
  return { ok: true, value: s };
}

export const DOCTOR_PAYMENT_TYPE_OPTIONS = [
  { value: "percentage", label: "نسبة من الجلسات" },
  { value: "salary", label: "راتب ثابت شهري" },
] as const;

export const USER_ROLE_LABELS: Record<string, string> = {
  super_admin: "مدير النظام",
  accountant: "محاسب / استقبال",
  doctor: "طبيب",
  assistant: "مساعد طبيب",
};

export const APP_NAME = "ماستر كلينك بلس";
export const APP_NAME_EN = "Master Clinic Plus";

/** Iraqi Dinar — ISO code for APIs/Intl; Arabic label in UI */
export const CURRENCY_CODE = "IQD";
export const CURRENCY_SYMBOL_AR = "د.ع";

export const DEVELOPER = {
  nameAr:   "حيدر حازم الموسوي",
  nameEn:   "Haider Hazim Al-Mousawi",
  role:     "Full-Stack Developer & System Architect",
  roleAr:   "مطوّر النظام ومهندس المعمارية",
  year:     2026,
} as const;
