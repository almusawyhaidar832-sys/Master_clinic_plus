import { authPortalHeaders } from "@/lib/auth/api-portal";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import type { ClinicalByOperationId } from "@/lib/clinical/types";

/** جلب السجل الطبي البصري لجميع جلسات المريض */
export async function fetchPatientClinicalRecords(
  patientId: string,
  portal: AuthPortalId = "doctor"
): Promise<ClinicalByOperationId> {
  try {
    const res = await fetch(
      `/api/clinical/session-records?patient_id=${encodeURIComponent(patientId)}`,
      {
        credentials: "include",
        headers: authPortalHeaders(portal),
      }
    );
    if (!res.ok) return {};
    const json = (await res.json()) as { byOperation?: ClinicalByOperationId };
    return json.byOperation ?? {};
  } catch {
    return {};
  }
}
