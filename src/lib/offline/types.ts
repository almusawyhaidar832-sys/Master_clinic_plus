import type { PatientFinancialPlan } from "@/lib/services/patient-financial-plan";
import type { DoctorShareInput } from "@/lib/finance";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import type { ToothRecordInput } from "@/lib/clinical/constants";
import type { PrescriptionMedication } from "@/lib/prescriptions/types";

export const OFFLINE_DB_NAME = "mcp_offline_v1";
export const OFFLINE_DB_VERSION = 2;
export const OFFLINE_QUEUE_STORE = "pending_ops";
export const OFFLINE_BLOBS_STORE = "offline_blobs";

export const OFFLINE_QUEUE_CHANGED_EVENT = "mcp-offline-queue-changed";

export type OfflineQueueStatus = "pending" | "syncing" | "failed";

export type OfflineQueueItemType =
  | "quick_entry"
  | "add_patient"
  | "queue_add"
  | "clinical_record"
  | "prescription_save";

export interface QuickEntryOfflinePayload {
  version: 1;
  clinicId: string;
  selectedPatientId: string | null;
  patientQuery: string;
  patientPhone: string;
  doctorId: string;
  sessionDoctorId: string;
  doctorShareInput: DoctorShareInput | null;
  forceNewPlan: boolean;
  selectedCaseId: string | null;
  entryMode: "plan" | "payment";
  operationLabel: string;
  casePrice: number;
  discount: number;
  paid: number;
  additionalDiscount: number;
  materials: number;
  isReviewStatement: boolean;
  reviewFeeLive: number;
  notes: string;
  labNotes: string;
  financialPlan: PatientFinancialPlan | null;
  treatmentCaseId: string | null;
  visitQueueEntryId: string | null;
  clinicalTeeth: Record<number, ToothRecordInput>;
  clientId: string;
  enqueuedAt: string;
}

export interface AddPatientOfflinePayload {
  version: 1;
  clinicId: string;
  name: string;
  phone: string;
  notes: string;
  clientId: string;
  enqueuedAt: string;
}

export interface QueueAddOfflinePayload {
  version: 1;
  clinicId: string;
  doctorId: string;
  patientName: string;
  patientPhone: string;
  patientId: string | null;
  sendToDoctor: boolean;
  clientId: string;
  enqueuedAt: string;
}

export interface ClinicalRecordOfflinePayload {
  version: 1;
  clinicId: string;
  operationId: string;
  portal: AuthPortalId;
  teeth: ToothRecordInput[];
  xrayBlobIds: string[];
  clientId: string;
  enqueuedAt: string;
}

export interface PrescriptionOfflinePayload {
  version: 1;
  clinicId: string;
  operationId: string;
  patientId: string;
  doctorId: string;
  queueEntryId: string | null;
  portal: AuthPortalId;
  diagnosisAr: string;
  notesAr: string;
  medications: PrescriptionMedication[];
  clientId: string;
  enqueuedAt: string;
}

type OfflineQueueRecordBase = {
  id: string;
  status: OfflineQueueStatus;
  createdAt: string;
  lastError?: string;
  retryCount: number;
};

export type OfflineQueueRecord =
  | (OfflineQueueRecordBase & {
      type: "quick_entry";
      payload: QuickEntryOfflinePayload;
    })
  | (OfflineQueueRecordBase & {
      type: "add_patient";
      payload: AddPatientOfflinePayload;
    })
  | (OfflineQueueRecordBase & {
      type: "queue_add";
      payload: QueueAddOfflinePayload;
    })
  | (OfflineQueueRecordBase & {
      type: "clinical_record";
      payload: ClinicalRecordOfflinePayload;
    })
  | (OfflineQueueRecordBase & {
      type: "prescription_save";
      payload: PrescriptionOfflinePayload;
    });

export function notifyOfflineQueueChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OFFLINE_QUEUE_CHANGED_EVENT));
}

export function isOfflinePatientRef(id: string | null | undefined): boolean {
  return Boolean(id?.startsWith("offline-patient:"));
}
