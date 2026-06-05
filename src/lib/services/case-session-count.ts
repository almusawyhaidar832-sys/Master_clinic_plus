import {
  groupOperationsByTreatmentCase,
  operationCaseKey,
} from "@/lib/services/group-operations-by-case";
import {
  collectOperationsForTreatmentCase,
  isPersistedTreatmentCaseId,
  opsBelongToCase,
  treatmentNameKey,
  type PatientTreatmentCase,
} from "@/lib/services/patient-treatment-cases";
import type { PatientOperation } from "@/types";

export type CaseSessionIndex = {
  /** رقم الجلسة داخل هذه الحالة (1-based) */
  sessionNumber: number;
  /** إجمالي جلسات هذه الحالة */
  totalSessionsInCase: number;
};

export function sortOpsChronologically(
  ops: PatientOperation[]
): PatientOperation[] {
  return [...ops].sort((a, b) => {
    const ta = a.created_at ?? a.operation_date ?? "";
    const tb = b.created_at ?? b.operation_date ?? "";
    return ta.localeCompare(tb);
  });
}

function filterOpsForCase(
  allOps: PatientOperation[],
  currentOp: PatientOperation,
  caseHint?: Pick<PatientTreatmentCase, "id" | "treatment_name_ar"> | null
): PatientOperation[] {
  if (caseHint) {
    let matched = allOps.filter((o) => opsBelongToCase(caseHint, o));
    if (matched.length === 0 && caseHint.id) {
      matched = allOps.filter(
        (o) => o.treatment_case_id?.trim() === caseHint.id
      );
    }
    if (matched.length > 0) return sortOpsChronologically(matched);
  }

  const linked = currentOp.treatment_case_id?.trim();
  if (linked) {
    const byLink = allOps.filter((o) => o.treatment_case_id?.trim() === linked);
    if (byLink.length > 0) return sortOpsChronologically(byLink);
  }

  const nameKey = operationCaseKey(currentOp);
  const byName = allOps.filter((o) => operationCaseKey(o) === nameKey);
  if (byName.length > 0) return sortOpsChronologically(byName);

  return sortOpsChronologically(allOps);
}

/** عدّ الجلسة داخل الحالة الحالية — لا يجمع جلسات حالات أخرى */
export function getCaseSessionIndex(
  allOps: PatientOperation[],
  currentOpId: string,
  caseHint?: Pick<PatientTreatmentCase, "id" | "treatment_name_ar"> | null
): CaseSessionIndex {
  const currentOp = allOps.find((o) => o.id === currentOpId);
  if (!currentOp) {
    return { sessionNumber: 1, totalSessionsInCase: 1 };
  }

  const caseOps = filterOpsForCase(allOps, currentOp, caseHint);
  const idx = caseOps.findIndex((o) => o.id === currentOpId);
  const sessionNumber = idx >= 0 ? idx + 1 : caseOps.length + 1;

  return {
    sessionNumber,
    totalSessionsInCase: Math.max(caseOps.length, sessionNumber),
  };
}

/** عدّ الجلسة من قائمة جلسات الحالة جاهزة (بعد الدمج) */
export function getCaseSessionIndexFromOps(
  caseOps: PatientOperation[],
  currentOpId: string
): CaseSessionIndex {
  const sorted = sortOpsChronologically(caseOps);
  const idx = sorted.findIndex((o) => o.id === currentOpId);
  const sessionNumber = idx >= 0 ? idx + 1 : sorted.length + 1;
  return {
    sessionNumber,
    totalSessionsInCase: Math.max(sorted.length, sessionNumber),
  };
}

function resolveSessionGroupForCase(
  groups: ReturnType<typeof groupOperationsByTreatmentCase>,
  caseHint: Pick<PatientTreatmentCase, "id" | "treatment_name_ar"> | null,
  currentOpId: string
) {
  const hintId = caseHint?.id?.trim();
  const hintNameKey = caseHint
    ? treatmentNameKey(caseHint.treatment_name_ar)
    : null;

  let group = groups.find((g) => {
    if (hintId && isPersistedTreatmentCaseId(hintId)) {
      if (g.caseId === hintId) return true;
      if (g.caseInfo?.id === hintId) return true;
    }
    if (hintNameKey && treatmentNameKey(g.treatmentName) === hintNameKey) {
      return true;
    }
    return false;
  });

  if (!group) {
    group = groups.find((g) => g.sessions.some((s) => s.id === currentOpId));
  }

  return group;
}

/**
 * عدّ الجلسة لهذه الحالة — يدمج case_id + الاسم العربي ثم ي fallback للتجميع بالواجهة.
 */
export function getCaseSessionIndexForTreatmentCase(
  allOps: PatientOperation[],
  currentOpId: string,
  caseHint: Pick<PatientTreatmentCase, "id" | "treatment_name_ar">,
  treatmentCases?: PatientTreatmentCase[]
): CaseSessionIndex {
  const collected = collectOperationsForTreatmentCase(allOps, caseHint);
  if (collected.length > 0) {
    return getCaseSessionIndexFromOps(collected, currentOpId);
  }
  if (treatmentCases?.length) {
    return getCaseSessionIndexWithTreatmentCases(
      allOps,
      currentOpId,
      treatmentCases,
      caseHint
    );
  }
  return getCaseSessionIndex(allOps, currentOpId, caseHint);
}

/**
 * عدّ الجلسة بنفس منطق عرض «الجلسات حسب الحالة» في ملف المريض —
 * يجمع بالاسم أولاً حتى لو treatment_case_id قديم أو خاطئ.
 */
export function getCaseSessionIndexWithTreatmentCases(
  allOps: PatientOperation[],
  currentOpId: string,
  treatmentCases: PatientTreatmentCase[],
  caseHint?: Pick<PatientTreatmentCase, "id" | "treatment_name_ar"> | null
): CaseSessionIndex {
  if (!allOps.length) {
    return { sessionNumber: 1, totalSessionsInCase: 1 };
  }

  const groups = groupOperationsByTreatmentCase(allOps, treatmentCases);
  const group = resolveSessionGroupForCase(
    groups,
    caseHint ?? null,
    currentOpId
  );

  if (group && group.sessions.length > 0) {
    return getCaseSessionIndexFromOps(group.sessions, currentOpId);
  }

  return getCaseSessionIndex(allOps, currentOpId, caseHint);
}
