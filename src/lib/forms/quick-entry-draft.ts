import type { ToothRecordInput } from "@/lib/clinical/constants";

export interface QuickEntryFormDraft {
  savedAt: string;
  patientQuery: string;
  patientPhone: string;
  selectedPatientId: string | null;
  doctorId: string;
  operationName: string;
  totalAmount: string;
  paidAmount: string;
  discountAmount: string;
  additionalDiscountAmount: string;
  materialsCost: string;
  labNotes: string;
  notes: string;
  isReviewStatement: boolean;
  reviewFeeEnabled: boolean;
  selectedCaseId: string | null;
  forceNewPlan: boolean;
  clinicalTeeth: Record<number, ToothRecordInput>;
  showVisualRecordReview: boolean;
}

export function quickEntryDraftKey(input: {
  visitQueueEntryId?: string | null;
  defaultPatientId?: string | null;
}): string {
  if (input.visitQueueEntryId) {
    return `mcp:quick-entry:queue:${input.visitQueueEntryId}`;
  }
  if (input.defaultPatientId) {
    return `mcp:quick-entry:patient:${input.defaultPatientId}`;
  }
  return "mcp:quick-entry:ledger";
}

export function hasQuickEntryDraftContent(draft: QuickEntryFormDraft): boolean {
  return Boolean(
    draft.patientQuery.trim() ||
      draft.patientPhone.trim() ||
      draft.selectedPatientId ||
      draft.operationName.trim() ||
      draft.totalAmount.trim() ||
      draft.paidAmount.trim() ||
      draft.discountAmount.trim() ||
      draft.additionalDiscountAmount.trim() ||
      draft.materialsCost.trim() ||
      draft.labNotes.trim() ||
      draft.notes.trim() ||
      Object.keys(draft.clinicalTeeth ?? {}).length > 0
  );
}
