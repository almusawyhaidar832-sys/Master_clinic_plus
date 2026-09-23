/** نسب الطبيب والمختبر — أي رقم صحيح من 0 إلى 100 */

export function isValidPercentage0To100(value: unknown): boolean {
  const s = String(value ?? "").trim();
  if (!/^\d{1,3}$/.test(s)) return false;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n <= 100;
}

export function normalizePercentage0To100(
  value: unknown,
  fallback: string
): string {
  const s = String(value ?? "").trim();
  return isValidPercentage0To100(s) ? String(Number(s)) : fallback;
}

export function parsePercentage0To100Strict(
  value: unknown,
  fieldLabel: string
): { ok: true; value: string } | { ok: false; error: string } {
  const s = String(value ?? "").trim();
  if (!isValidPercentage0To100(s)) {
    return {
      ok: false,
      error: `${fieldLabel} يجب أن تكون رقماً صحيحاً بين 0 و 100`,
    };
  }
  return { ok: true, value: String(Number(s)) };
}

export function formatPercentageLabel(value: unknown): string {
  return `${normalizePercentage0To100(value, "0")}%`;
}

export function materialsShareHint(value: unknown): string | null {
  const n = Number(normalizePercentage0To100(value, "0"));
  if (n === 0) return "على العيادة بالكامل";
  if (n === 50) return "تقسيم مناصفة";
  if (n === 100) return "على الطبيب بالكامل";
  return null;
}

const pct = (n: number) => ({ value: String(n), label: `${n}%` }) as const;

/** للتوافق مع القوائم القديمة — توليد 0–100 */
export const DOCTOR_PERCENTAGE_OPTIONS = Array.from({ length: 101 }, (_, i) =>
  pct(i)
);

export const MATERIALS_SHARE_OPTIONS = Array.from({ length: 101 }, (_, i) => {
  const hint = materialsShareHint(String(i));
  return {
    value: String(i),
    label: hint ? `${i}% — ${hint}` : `${i}%`,
  };
});

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
  return normalizePercentage0To100(value, fallback);
}

export function parseDoctorPercentageStrict(
  value: unknown
): { ok: true; value: string } | { ok: false; error: string } {
  return parsePercentage0To100Strict(value, "نسبة الطبيب");
}

export function normalizeMaterialsShare(
  value: unknown,
  fallback = "0"
): string {
  return normalizePercentage0To100(value, fallback);
}

export function parseMaterialsShareStrict(
  value: unknown
): { ok: true; value: string } | { ok: false; error: string } {
  return parsePercentage0To100Strict(value, "نسبة تحمّل المختبر");
}

/** رسالة واضحة عندما قاعدة البيانات لم تُحدَّث لدعم النسبة المختارة */
export function formatDoctorEnumDbError(dbMessage: string): string {
  if (
    dbMessage.includes("doctor_percentage") ||
    dbMessage.includes("materials_cost_share")
  ) {
    return (
      "النسبة المختارة غير مدعومة في قاعدة البيانات بعد. " +
      "افتح Supabase → SQL Editor وشغّل الملف: supabase/scripts/29-doctor-percentage-0-100-full.sql ثم أعد المحاولة."
    );
  }
  return dbMessage;
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
  nameEn:   "Haidar Hazem Almusawi",
  initials: "HH",
  role:     "Full-Stack Developer & Product Designer",
  roleAr:   "مطوّر برمجيات ومصمم المنتج",
  year:     2026,
} as const;
