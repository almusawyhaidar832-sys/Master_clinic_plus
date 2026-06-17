import { idbDelete, idbGetAll, idbPut } from "@/lib/offline/idb";
import {
  notifyOfflineQueueChanged,
  type AddPatientOfflinePayload,
  type ClinicalRecordOfflinePayload,
  type OfflineQueueRecord,
  type OfflineQueueStatus,
  type PrescriptionOfflinePayload,
  type QueueAddOfflinePayload,
  type QuickEntryOfflinePayload,
} from "@/lib/offline/types";
import { storeOfflineBlobs } from "@/lib/offline/blob-store";
import { teethFromDraft } from "@/lib/clinical/session-records";
import type { SessionClinicalDraft } from "@/lib/clinical/constants";
import type { AuthPortalId } from "@/lib/auth/portal-access";

function newQueueId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `offline-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function newClientId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `client-${Date.now()}`;
}

export async function listOfflineQueue(): Promise<OfflineQueueRecord[]> {
  const rows = await idbGetAll<OfflineQueueRecord>();
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function countPendingOfflineQueue(): Promise<number> {
  const rows = await listOfflineQueue();
  return rows.filter((r) => r.status === "pending" || r.status === "failed").length;
}

async function enqueueRecord(
  record: OfflineQueueRecord
): Promise<OfflineQueueRecord> {
  await idbPut(record);
  notifyOfflineQueueChanged();
  return record;
}

export async function enqueueQuickEntryOffline(
  payload: QuickEntryOfflinePayload
): Promise<OfflineQueueRecord> {
  return enqueueRecord({
    id: newQueueId(),
    type: "quick_entry",
    payload,
    status: "pending",
    createdAt: new Date().toISOString(),
    retryCount: 0,
  });
}

export async function enqueueAddPatientOffline(
  input: Omit<AddPatientOfflinePayload, "version" | "clientId" | "enqueuedAt">
): Promise<OfflineQueueRecord> {
  const payload: AddPatientOfflinePayload = {
    version: 1,
    ...input,
    clientId: newClientId(),
    enqueuedAt: new Date().toISOString(),
  };
  return enqueueRecord({
    id: newQueueId(),
    type: "add_patient",
    payload,
    status: "pending",
    createdAt: new Date().toISOString(),
    retryCount: 0,
  });
}

export async function enqueueQueueAddOffline(
  input: Omit<QueueAddOfflinePayload, "version" | "clientId" | "enqueuedAt">
): Promise<OfflineQueueRecord> {
  const payload: QueueAddOfflinePayload = {
    version: 1,
    ...input,
    clientId: newClientId(),
    enqueuedAt: new Date().toISOString(),
  };
  return enqueueRecord({
    id: newQueueId(),
    type: "queue_add",
    payload,
    status: "pending",
    createdAt: new Date().toISOString(),
    retryCount: 0,
  });
}

export async function enqueueClinicalRecordOffline(input: {
  clinicId: string;
  operationId: string;
  portal: AuthPortalId;
  draft: SessionClinicalDraft;
}): Promise<OfflineQueueRecord> {
  const queueId = newQueueId();
  const xrayBlobIds =
    input.draft.xrayFiles.length > 0
      ? await storeOfflineBlobs(queueId, input.draft.xrayFiles)
      : [];

  const payload: ClinicalRecordOfflinePayload = {
    version: 1,
    clinicId: input.clinicId,
    operationId: input.operationId,
    portal: input.portal,
    teeth: teethFromDraft(input.draft),
    xrayBlobIds,
    clientId: newClientId(),
    enqueuedAt: new Date().toISOString(),
  };

  return enqueueRecord({
    id: queueId,
    type: "clinical_record",
    payload,
    status: "pending",
    createdAt: new Date().toISOString(),
    retryCount: 0,
  });
}

export async function enqueuePrescriptionOffline(
  input: Omit<PrescriptionOfflinePayload, "version" | "clientId" | "enqueuedAt">
): Promise<OfflineQueueRecord> {
  const payload: PrescriptionOfflinePayload = {
    version: 1,
    ...input,
    clientId: newClientId(),
    enqueuedAt: new Date().toISOString(),
  };
  return enqueueRecord({
    id: newQueueId(),
    type: "prescription_save",
    payload,
    status: "pending",
    createdAt: new Date().toISOString(),
    retryCount: 0,
  });
}

export async function updateOfflineQueueStatus(
  id: string,
  status: OfflineQueueStatus,
  lastError?: string
): Promise<void> {
  const rows = await listOfflineQueue();
  const row = rows.find((r) => r.id === id);
  if (!row) return;
  const next: OfflineQueueRecord = {
    ...row,
    status,
    lastError,
    retryCount: status === "failed" ? row.retryCount + 1 : row.retryCount,
  };
  await idbPut(next);
  notifyOfflineQueueChanged();
}

export async function removeOfflineQueueItem(id: string): Promise<void> {
  await idbDelete(id);
  notifyOfflineQueueChanged();
}

/** مراجع أُضيف offline — يُربط لاحقاً عند المزامنة */
export function makeOfflinePatientRef(clientId: string): string {
  return `offline-patient:${clientId}`;
}
