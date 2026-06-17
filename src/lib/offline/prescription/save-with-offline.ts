import type { AuthPortalId } from "@/lib/auth/portal-access";
import type { PrescriptionMedication } from "@/lib/prescriptions/types";
import { savePrescription } from "@/lib/prescriptions/client";
import type { PatientPrescription } from "@/lib/prescriptions/types";
import { isBrowserOffline } from "@/lib/offline/network";
import { tryEnqueuePrescriptionOffline } from "@/lib/offline/prescription/enqueue";

export async function savePrescriptionWithOfflineFallback(
  input: {
    operationId: string;
    patientId: string;
    doctorId: string;
    queueEntryId?: string | null;
    diagnosisAr?: string;
    notesAr?: string;
    medications: PrescriptionMedication[];
  },
  portal: AuthPortalId = "doctor",
  clinicId?: string | null
): Promise<
  | { ok: true; prescription: PatientPrescription; offline: false }
  | { ok: true; offline: true; message: string }
  | { ok: false; error: string; offline?: boolean }
> {
  if (isBrowserOffline()) {
    const attempt = await tryEnqueuePrescriptionOffline({
      clinicId,
      operationId: input.operationId,
      patientId: input.patientId,
      doctorId: input.doctorId,
      queueEntryId: input.queueEntryId,
      portal,
      diagnosisAr: input.diagnosisAr ?? "",
      notesAr: input.notesAr ?? "",
      medications: input.medications,
    });
    if (attempt.handled) {
      if (attempt.ok) {
        return { ok: true, offline: true, message: attempt.message };
      }
      return { ok: false, error: attempt.message, offline: false };
    }
  }

  try {
    const prescription = await savePrescription(input, portal);
    return { ok: true, prescription, offline: false };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "تعذر حفظ الوصفة",
    };
  }
}
