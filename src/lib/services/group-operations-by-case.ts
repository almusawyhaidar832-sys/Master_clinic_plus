import {
  isPersistedTreatmentCaseId,
  treatmentNameKey,
  type PatientTreatmentCase,
} from "@/lib/services/patient-treatment-cases";
import { isTreatmentCaseComplete } from "@/lib/services/patient-financial-plan";
import {
  operationLabelForCase,
  opName,
  type PatientOperation,
} from "@/types";

/** مفتاح تجميع الجلسات حسب اسم الحالة */
export function operationCaseKey(op: PatientOperation): string {
  return treatmentNameKey(operationLabelForCase(op));
}

export interface TreatmentCaseSessionGroup {
  key: string;
  treatmentName: string;
  /** UUID من patient_treatment_cases عند التوفر */
  caseId: string | null;
  caseInfo: PatientTreatmentCase | null;
  sessions: PatientOperation[];
  sessionCount: number;
}

/** ربط الجلسة بالحالة — treatment_case_id أولاً (حالتان بنفس الاسم منفصلتان) */
function resolveGroupKeyForOp(
  op: PatientOperation,
  casesByNameCount: Map<string, number>
): { key: string; caseId: string | null } {
  const linked = op.treatment_case_id?.trim();
  if (linked && isPersistedTreatmentCaseId(linked)) {
    return { key: `case:${linked}`, caseId: linked };
  }
  const nameKey = operationCaseKey(op);
  if ((casesByNameCount.get(nameKey) ?? 0) <= 1) {
    return { key: `name:${nameKey}`, caseId: null };
  }
  return { key: `orphan:${op.id}`, caseId: null };
}

export function groupOperationsByTreatmentCase(
  operations: PatientOperation[],
  treatmentCases: PatientTreatmentCase[]
): TreatmentCaseSessionGroup[] {
  const visibleOps = operations.filter((op) => op.session_kind !== "refund");

  const caseById = new Map<string, PatientTreatmentCase>();
  const caseByKey = new Map<string, PatientTreatmentCase>();
  const casesByNameCount = new Map<string, number>();
  for (const c of treatmentCases) {
    if (isPersistedTreatmentCaseId(c.id)) {
      caseById.set(c.id, c);
    }
    const nk = treatmentNameKey(c.treatment_name_ar);
    casesByNameCount.set(nk, (casesByNameCount.get(nk) ?? 0) + 1);
    if ((casesByNameCount.get(nk) ?? 0) <= 1 && !caseByKey.has(nk)) {
      caseByKey.set(nk, c);
    } else if ((casesByNameCount.get(nk) ?? 0) > 1) {
      caseByKey.delete(nk);
    }
  }

  const byGroup = new Map<
    string,
    { caseId: string | null; sessions: PatientOperation[] }
  >();

  for (const op of visibleOps) {
    const { key: gKey, caseId: resolvedId } = resolveGroupKeyForOp(
      op,
      casesByNameCount
    );
    const bucket = byGroup.get(gKey) ?? {
      caseId: resolvedId,
      sessions: [],
    };
    if (resolvedId && !bucket.caseId) bucket.caseId = resolvedId;
    bucket.sessions.push(op);
    byGroup.set(gKey, bucket);
  }

  const groups: TreatmentCaseSessionGroup[] = [];

  for (const [key, bucket] of byGroup.entries()) {
    const sorted = [...bucket.sessions].sort((a, b) => {
      const ta = a.created_at ?? a.operation_date ?? "";
      const tb = b.created_at ?? b.operation_date ?? "";
      return tb.localeCompare(ta);
    });

    let caseInfo: PatientTreatmentCase | null = null;
    if (bucket.caseId && caseById.has(bucket.caseId)) {
      caseInfo = caseById.get(bucket.caseId)!;
    }
    if (!caseInfo) {
      const nameKey = key.startsWith("name:")
        ? key.slice(5)
        : operationCaseKey(sorted[0]);
      caseInfo = caseByKey.get(nameKey) ?? null;
    }

    const planOp = sorted.find(
      (o) => o.session_kind === "plan" || Number(o.total_amount) > 0
    );
    const treatmentName =
      caseInfo?.treatment_name_ar ??
      (planOp
        ? opName(planOp).replace(/\s*—\s*خصم.*$/i, "").trim()
        : opName(sorted[0]));

    const resolvedCaseId =
      (caseInfo && isPersistedTreatmentCaseId(caseInfo.id)
        ? caseInfo.id
        : null) ??
      (bucket.caseId && isPersistedTreatmentCaseId(bucket.caseId)
        ? bucket.caseId
        : null);

    groups.push({
      key,
      treatmentName,
      caseId: resolvedCaseId,
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
