import type { PatientPrescription } from "@/lib/prescriptions/types";

/** وصفة فعلية — فيها دواء واحد على الأقل باسم غير فارغ */
export function prescriptionHasContent(
  prescription:
    | Pick<PatientPrescription, "medications">
    | PatientPrescription
    | null
    | undefined
): boolean {
  if (!prescription?.medications?.length) return false;
  return prescription.medications.some(
    (m) => String(m.drug_name_ar ?? "").trim().length > 0
  );
}
