import type { PrescriptionMedication } from "@/lib/prescriptions/types";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import { shouldEnqueueOffline, type OfflineEnqueueOptions } from "@/lib/offline/enqueue-guard";
import { enqueuePrescriptionOffline } from "@/lib/offline/queue-store";
import { getCachedOfflineReference } from "@/lib/offline/reference-cache";

export type PrescriptionOfflineAttemptResult =
  | { handled: false }
  | { handled: true; ok: true; message: string }
  | { handled: true; ok: false; message: string };

export async function tryEnqueuePrescriptionOffline(input: {
  clinicId?: string | null;
  operationId: string;
  patientId: string;
  doctorId: string;
  queueEntryId?: string | null;
  portal: AuthPortalId;
  diagnosisAr: string;
  notesAr: string;
  medications: PrescriptionMedication[];
}, options?: OfflineEnqueueOptions): Promise<PrescriptionOfflineAttemptResult> {
  if (!shouldEnqueueOffline(options)) {
    return { handled: false };
  }

  const clinicId =
    input.clinicId ?? getCachedOfflineReference()?.clinicId ?? null;
  if (!clinicId) {
    return {
      handled: true,
      ok: false,
      message:
        "لا يمكن الحفظ بدون نت — افتح النظام مرة مع اتصال لتحميل بيانات العيادة",
    };
  }

  const meds = input.medications.filter((m) => m.drug_name_ar.trim());
  if (!meds.length) {
    return {
      handled: true,
      ok: false,
      message: "أضف اسم دواء واحد على الأقل قبل الحفظ",
    };
  }

  try {
    await enqueuePrescriptionOffline({
      clinicId,
      operationId: input.operationId,
      patientId: input.patientId,
      doctorId: input.doctorId,
      queueEntryId: input.queueEntryId ?? null,
      portal: input.portal,
      diagnosisAr: input.diagnosisAr,
      notesAr: input.notesAr,
      medications: meds,
    });
    return {
      handled: true,
      ok: true,
      message:
        "تم حفظ الوصفة محلياً — ستظهر للمحاسب بعد عودة النت والمزامنة",
    };
  } catch (err) {
    return {
      handled: true,
      ok: false,
      message:
        err instanceof Error
          ? `تعذر الحفظ المحلي: ${err.message}`
          : "تعذر الحفظ المحلي",
    };
  }
}
