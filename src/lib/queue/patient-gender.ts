/** جنس المراجع — للنداء الصوتي (مراجع / مراجعة) */

export type PatientGender = "male" | "female";

const FEMALE_NAME_HINTS =
  /^(فاط|فاطم|زهر|زين|سمر|نور|هد|هيف|مري|سع|رنا|دع|إيمان|ايمان|بت|شيم|رغ|سلم|لم|حسن)/;

export function resolvePatientGender(entry: {
  patient?: { gender?: string | null; full_name_ar?: string } | null;
  patient_name?: string | null;
}): PatientGender | null {
  const stored = entry.patient?.gender;
  if (stored === "male" || stored === "female") return stored;

  const name =
    entry.patient?.full_name_ar?.trim() || entry.patient_name?.trim() || "";
  if (!name) return null;

  return inferGenderFromArabicName(name);
}

export function inferGenderFromArabicName(name: string): PatientGender | null {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return null;

  const first = trimmed.split(/\s+/)[0] ?? trimmed;
  const normalized = first.replace(/[^\u0600-\u06FF]/g, "");

  if (normalized.endsWith("ة") || normalized.endsWith("ى")) {
    return "female";
  }
  if (FEMALE_NAME_HINTS.test(normalized)) {
    return "female";
  }

  return "male";
}
