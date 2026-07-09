import { authPortalHeaders } from "@/lib/auth/api-portal";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import { fetchVisitSessionByQueue } from "@/lib/clinical/visit-session-client";
import { prescriptionHasContent } from "@/lib/prescriptions/content";
import type {
  PatientPrescription,
  PrescriptionMedication,
  PrescriptionPrintData,
} from "@/lib/prescriptions/types";

export async function fetchPrescriptionByQueueEntry(
  queueEntryId: string,
  portal: AuthPortalId = "accountant"
): Promise<PatientPrescription | null> {
  const params = new URLSearchParams({ queue_entry_id: queueEntryId });
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

/** جلب وصفة الجلسة — بالطابور أولاً ثم جلسة الكشف، مع إعادة محاولة خفيفة */
export async function resolvePrescriptionForSession(
  input: { queueEntryId?: string | null; operationId?: string | null },
  portal: AuthPortalId = "accountant",
  options?: { retries?: number; retryDelayMs?: number }
): Promise<PatientPrescription | null> {
  const retries = options?.retries ?? 1;
  const retryDelayMs = options?.retryDelayMs ?? 500;
  const queueEntryId = String(input.queueEntryId ?? "").trim() || null;
  const operationIdHint = String(input.operationId ?? "").trim() || null;

  for (let attempt = 0; attempt < retries; attempt++) {
    const byQueuePromise = queueEntryId
      ? fetchPrescriptionByQueueEntry(queueEntryId, portal).catch(() => null)
      : Promise.resolve(null);

    const operationIdPromise = operationIdHint
      ? Promise.resolve(operationIdHint)
      : queueEntryId
        ? fetchVisitSessionByQueue(queueEntryId, portal)
            .then((session) => session?.operationId ?? null)
            .catch(() => null)
        : Promise.resolve(null);

    const [byQueue, operationId] = await Promise.all([
      byQueuePromise,
      operationIdPromise,
    ]);

    if (byQueue && prescriptionHasContent(byQueue)) return byQueue;

    const operationLookups: Promise<PatientPrescription | null>[] = [];

    if (operationIdHint && !queueEntryId) {
      operationLookups.push(
        fetchPrescriptionByOperationLinked(operationIdHint, portal).catch(
          () => null
        )
      );
    }

    if (operationId) {
      operationLookups.push(
        fetchPrescriptionByOperation(operationId, portal, queueEntryId).catch(
          () => null
        ),
        fetchPrescriptionByOperationLinked(operationId, portal).catch(
          () => null
        )
      );
    }

    if (operationLookups.length > 0) {
      const results = await Promise.all(operationLookups);
      for (const rx of results) {
        if (rx && prescriptionHasContent(rx)) return rx;
      }
    }

    if (attempt < retries - 1) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  return null;
}

export async function fetchPrescriptionByOperationLinked(
  operationId: string,
  portal: AuthPortalId = "accountant"
): Promise<PatientPrescription | null> {
  const params = new URLSearchParams({
    operation_id: operationId,
    resolve_linked: "1",
  });
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
