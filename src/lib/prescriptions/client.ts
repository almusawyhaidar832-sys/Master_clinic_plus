import { authPortalHeaders } from "@/lib/auth/api-portal";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import type {
  PatientPrescription,
  PrescriptionMedication,
  PrescriptionPrintData,
} from "@/lib/prescriptions/types";

export async function fetchPrescriptionByOperation(
  operationId: string,
  portal: AuthPortalId = "doctor",
  queueEntryId?: string | null
): Promise<PatientPrescription | null> {
  const params = new URLSearchParams({ operation_id: operationId });
  if (queueEntryId) {
    params.set("queue_entry_id", queueEntryId);
  }
  const res = await fetch(`/api/prescriptions?${params}`, {
    credentials: "include",
    headers: authPortalHeaders(portal),
  });

  if (res.status === 404) return null;

  const json = (await res.json().catch(() => ({}))) as {
    prescription?: PatientPrescription;
    error?: string;
  };

  if (!res.ok) {
    throw new Error(json.error ?? "تعذر تحميل الوصفة");
  }

  return json.prescription ?? null;
}

export async function savePrescription(
  input: {
    operationId: string;
    patientId: string;
    doctorId: string;
    queueEntryId?: string | null;
    diagnosisAr?: string;
    notesAr?: string;
    medications: PrescriptionMedication[];
  },
  portal: AuthPortalId = "doctor"
): Promise<PatientPrescription> {
  const res = await fetch("/api/prescriptions", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...authPortalHeaders(portal),
    },
    body: JSON.stringify({
      operation_id: input.operationId,
      patient_id: input.patientId,
      doctor_id: input.doctorId,
      queue_entry_id: input.queueEntryId ?? undefined,
      diagnosis_ar: input.diagnosisAr,
      notes_ar: input.notesAr,
      medications: input.medications,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    prescription?: PatientPrescription;
    error?: string;
  };

  if (!res.ok) {
    throw new Error(json.error ?? "تعذر حفظ الوصفة");
  }

  if (!json.prescription) {
    throw new Error("تعذر حفظ الوصفة");
  }

  return json.prescription;
}

export async function fetchPrescriptionPrintData(
  prescriptionId: string,
  portal: AuthPortalId = "accountant"
): Promise<PrescriptionPrintData> {
  const params = new URLSearchParams({ id: prescriptionId, print: "1" });
  const res = await fetch(`/api/prescriptions?${params}`, {
    credentials: "include",
    headers: authPortalHeaders(portal),
  });

  const json = (await res.json().catch(() => ({}))) as PrescriptionPrintData & {
    error?: string;
  };

  if (!res.ok) {
    throw new Error(json.error ?? "تعذر تحميل بيانات الطباعة");
  }

  return json;
}

export async function markPrescriptionPrinted(
  prescriptionId: string,
  portal: AuthPortalId = "accountant"
): Promise<PatientPrescription> {
  const res = await fetch(`/api/prescriptions/${prescriptionId}`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...authPortalHeaders(portal),
    },
    body: JSON.stringify({ action: "mark_printed" }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    prescription?: PatientPrescription;
    error?: string;
  };

  if (!res.ok) {
    throw new Error(json.error ?? "تعذر تسجيل الطباعة");
  }

  if (!json.prescription) {
    throw new Error("تعذر تسجيل الطباعة");
  }

  return json.prescription;
}
