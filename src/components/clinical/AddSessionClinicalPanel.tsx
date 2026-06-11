"use client";

import { VisualMedicalRecord } from "@/components/clinical/VisualMedicalRecord";
import type { OperationClinicalData } from "@/lib/clinical/types";

interface AddSessionClinicalPanelProps {
  operationId: string;
  existing?: OperationClinicalData | null;
  onSaved: () => void;
}

/** غلاف توافق — يستخدم VisualMedicalRecord المشترك */
export function AddSessionClinicalPanel({
  operationId,
  existing,
  onSaved,
}: AddSessionClinicalPanelProps) {
  return (
    <VisualMedicalRecord
      operationId={operationId}
      portal="doctor"
      initialData={existing}
      onSaved={onSaved}
      collapsible
      defaultOpen={false}
      className="mt-2"
    />
  );
}
