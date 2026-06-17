import type { PrescriptionMedication } from "@/lib/prescriptions/types";
import type { ToothRecordInput } from "@/lib/clinical/constants";

export interface PrescriptionFormDraft {
  savedAt: string;
  diagnosis: string;
  notes: string;
  lines: PrescriptionMedication[];
  templateId: string;
}

export function prescriptionDraftKey(
  portal: string,
  operationId: string
): string {
  return `mcp:prescription:${portal}:${operationId}`;
}

export function hasPrescriptionDraftContent(
  draft: Omit<PrescriptionFormDraft, "savedAt">
): boolean {
  return Boolean(
    draft.diagnosis.trim() ||
      draft.notes.trim() ||
      draft.templateId.trim() ||
      draft.lines.some((line) => line.drug_name_ar.trim())
  );
}

export interface ClinicalFormDraft {
  savedAt: string;
  teeth: Record<number, ToothRecordInput>;
}

export function clinicalDraftKey(
  portal: string,
  operationId: string
): string {
  return `mcp:clinical:${portal}:${operationId}`;
}

export function hasClinicalDraftContent(
  draft: Omit<ClinicalFormDraft, "savedAt">
): boolean {
  return Object.keys(draft.teeth ?? {}).length > 0;
}

export interface AddPatientFormDraft {
  savedAt: string;
  name: string;
  phone: string;
  notes: string;
}

export const ADD_PATIENT_DRAFT_KEY = "mcp:add-patient";

export function hasAddPatientDraftContent(
  draft: Omit<AddPatientFormDraft, "savedAt">
): boolean {
  return Boolean(draft.name.trim() || draft.phone.trim() || draft.notes.trim());
}

export interface NewDoctorFormDraft {
  savedAt: string;
  fullName: string;
  specialty: string;
  phone: string;
  percentage: string;
  materialsShare: string;
  paymentType: string;
  salaryAmount: string;
  username: string;
}

export function newDoctorDraftKey(clinicId: string): string {
  return `mcp:new-doctor:${clinicId}`;
}

export function hasNewDoctorDraftContent(
  draft: Omit<NewDoctorFormDraft, "savedAt">
): boolean {
  return Boolean(
    draft.fullName.trim() ||
      draft.specialty.trim() ||
      draft.phone.trim() ||
      draft.username.trim() ||
      draft.salaryAmount.trim() ||
      draft.percentage !== "50" ||
      draft.materialsShare !== "0"
  );
}

export interface DoctorPatientLogDraft {
  savedAt: string;
  newLog: string;
}

export function doctorPatientLogDraftKey(patientId: string): string {
  return `mcp:doctor-patient-log:${patientId}`;
}

export function hasDoctorPatientLogDraftContent(
  draft: Omit<DoctorPatientLogDraft, "savedAt">
): boolean {
  return Boolean(draft.newLog.trim());
}
