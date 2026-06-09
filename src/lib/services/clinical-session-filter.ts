import type { ClinicalByOperationId } from "@/lib/clinical/types";
import { hasClinicalData } from "@/lib/clinical/types";
import type { PatientOperation } from "@/types";

/**
 * سجل مالي فقط (دفعة / خصم / استرجاع) — لا يُعرض في سجل الجلسات الطبي.
 * المدفوعات تُلخَّص على مستوى الحالة في الملخص المالي.
 */
export function isFinancialOnlyOperation(op: PatientOperation): boolean {
  const kind = op.session_kind;
  if (kind === "refund" || kind === "payment" || kind === "discount") {
    return true;
  }

  const paid = Number(op.paid_amount ?? 0);
  const total = Number(op.total_amount ?? 0);
  if (paid > 0 && total <= 0 && kind !== "plan") {
    return true;
  }

  return false;
}

/** جلسة علاجية للعرض — العمل الطبي وليس سطر دفع */
export function isClinicalSessionForDisplay(
  op: PatientOperation,
  clinicalByOp?: ClinicalByOperationId
): boolean {
  if (!isFinancialOnlyOperation(op)) return true;
  if (clinicalByOp && hasClinicalData(clinicalByOp[op.id])) return true;
  return false;
}

export function filterClinicalSessions(
  operations: PatientOperation[],
  clinicalByOp?: ClinicalByOperationId
): PatientOperation[] {
  return operations.filter((op) =>
    isClinicalSessionForDisplay(op, clinicalByOp)
  );
}
