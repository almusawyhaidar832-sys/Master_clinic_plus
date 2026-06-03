import { treatmentNameKey } from "@/lib/services/patient-treatment-cases";
import type { PatientTreatmentCase } from "@/lib/services/patient-treatment-cases";
import { isTreatmentCaseComplete } from "@/lib/services/patient-financial-plan";
import { opName, type PatientOperation } from "@/types";

/** اسم الحالة من العملية (بدون لاحقة خصم إضافي) */
export function operationCaseKey(op: PatientOperation): string {
  const raw = opName(op).trim();
  const base = raw.replace(/\s*—\s*خصم.*$/i, "").trim() || raw;
  return treatmentNameKey(base);
}

export interface TreatmentCaseSessionGroup {
  key: string;
  treatmentName: string;
  caseInfo: PatientTreatmentCase | null;
  sessions: PatientOperation[];
  sessionCount: number;
}

export function groupOperationsByTreatmentCase(
  operations: PatientOperation[],
  treatmentCases: PatientTreatmentCase[]
): TreatmentCaseSessionGroup[] {
  const caseByKey = new Map<string, PatientTreatmentCase>();
  for (const c of treatmentCases) {
    caseByKey.set(treatmentNameKey(c.treatment_name_ar), c);
  }

  const byKey = new Map<string, PatientOperation[]>();
  for (const op of operations) {
    const key = operationCaseKey(op);
    const list = byKey.get(key) ?? [];
    list.push(op);
    byKey.set(key, list);
  }

  const groups: TreatmentCaseSessionGroup[] = [];

  for (const [key, sessions] of byKey.entries()) {
    const sorted = [...sessions].sort((a, b) => {
      const ta = a.created_at ?? a.operation_date ?? "";
      const tb = b.created_at ?? b.operation_date ?? "";
      return tb.localeCompare(ta);
    });

    const caseInfo = caseByKey.get(key) ?? null;
    const planOp = sorted.find(
      (o) => o.session_kind === "plan" || Number(o.total_amount) > 0
    );
    const treatmentName =
      caseInfo?.treatment_name_ar ??
      (planOp ? opName(planOp).replace(/\s*—\s*خصم.*$/i, "").trim() : opName(sorted[0]));

    groups.push({
      key,
      treatmentName,
      caseInfo,
      sessions: sorted,
      sessionCount: sorted.length,
    });
  }

  return groups.sort((a, b) => {
    const aComplete = a.caseInfo ? isTreatmentCaseComplete(a.caseInfo) : false;
    const bComplete = b.caseInfo ? isTreatmentCaseComplete(b.caseInfo) : false;
    if (aComplete !== bComplete) return aComplete ? 1 : -1;
    const aRem = a.caseInfo?.remaining_balance ?? 0;
    const bRem = b.caseInfo?.remaining_balance ?? 0;
    if (aRem !== bRem) return bRem - aRem;
    return a.treatmentName.localeCompare(b.treatmentName, "ar");
  });
}
