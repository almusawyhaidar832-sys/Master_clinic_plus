import { authPortalHeaders } from "@/lib/auth/api-portal";
import type { AuthPortalId } from "@/lib/auth/portal-access";

export interface VisitSessionPayload {
  operationId: string;
  queueEntryId: string | null;
  queueStatus: string | null;
  patientId: string;
  doctorId: string;
  appointmentId: string | null;
  ledgerUrl: string;
  withoutQueue?: boolean;
}

export async function ensureVisitSession(
  input: { patientId?: string | null; queueEntryId?: string | null },
  portal: AuthPortalId = "doctor"
): Promise<VisitSessionPayload> {
  const res = await fetch("/api/operations/visit-session", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...authPortalHeaders(portal),
    },
    body: JSON.stringify({
      patient_id: input.patientId ?? undefined,
      queue_entry_id: input.queueEntryId ?? undefined,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as VisitSessionPayload & {
    error?: string;
  };

  if (!res.ok) {
    throw new Error(json.error ?? "تعذر تجهيز جلسة الكشف");
  }

  return json;
}

export async function fetchVisitSessionByQueue(
  queueEntryId: string,
  portal: AuthPortalId = "accountant"
): Promise<VisitSessionPayload | null> {
  const params = new URLSearchParams({ queue_entry_id: queueEntryId });
  const res = await fetch(`/api/operations/visit-session?${params}`, {
    credentials: "include",
    headers: authPortalHeaders(portal),
  });

  if (res.status === 404) return null;

  const json = (await res.json().catch(() => ({}))) as VisitSessionPayload & {
    error?: string;
  };

  if (!res.ok) {
    throw new Error(json.error ?? "تعذر تحميل جلسة الزيارة");
  }

  return json;
}
