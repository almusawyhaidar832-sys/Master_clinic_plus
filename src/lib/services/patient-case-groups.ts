import type { ClinicalByOperationId } from "@/lib/clinical/types";
import { sortOpsChronologically } from "@/lib/services/case-session-count";
import { filterClinicalSessions } from "@/lib/services/clinical-session-filter";
import { groupOperationsByTreatmentCase } from "@/lib/services/group-operations-by-case";
import { FINANCIAL_EPSILON } from "@/lib/services/patient-financial-plan";
import {
  computedCaseRemaining,
  isTreatmentCaseComplete,
} from "@/lib/services/patient-financial-plan";
import {
  computeCasePaidFromOps,
  isPersistedTreatmentCaseId,
  treatmentCaseDisplayLabel,
  type PatientTreatmentCase,
} from "@/lib/services/patient-treatment-cases";
import type { PatientOperation } from "@/types";

/** جلسة واحدة داخل حالة — المبلغ المدفوع فيها فقط */
export interface CaseSessionItem {
  operation: PatientOperation;
  date: string;
  /** المبلغ المدفوع في هذه الجلسة فقط */
  amountPaid: number;
  sessionNumber: number;
}

/** حالة مجمّعة بمفتاح case_id (أو اسم الحالة) */
export interface PatientCaseGroup {
  key: string;
  caseId: string | null;
  caseName: string;
  /** السعر الكلي للحالة */
  total: number;
  /** مجموع المدفوع من جلسات هذه الحالة فقط */
  totalPaid: number;
  /** المتبقي على هذه الحالة فقط */
  remaining: number;
  sessions: CaseSessionItem[];
  caseInfo: PatientTreatmentCase | null;
  isComplete: boolean;
}

export type PatientCaseGroupsMap = Record<string, PatientCaseGroup>;

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function sessionDateIso(op: PatientOperation): string {
  return op.operation_date ?? op.created_at?.split("T")[0] ?? "";
}

/** حساب مالي للحالة من جلساتها فقط — لا يجمع حالات أخرى */
export function computeCaseFinancialsFromSessions(
  caseOps: PatientOperation[],
  caseInfo: PatientTreatmentCase | null
): { total: number; totalPaid: number; remaining: number } {
  const discount = caseInfo?.discount_total ?? 0;
  let finalPrice = 0;

  if (caseInfo) {
    finalPrice =
      caseInfo.final_price > 0
        ? caseInfo.final_price
        : Math.max(0, caseInfo.case_price - discount);
  }

  const paidMeta = computeCasePaidFromOps(caseOps, finalPrice);

  if (finalPrice <= FINANCIAL_EPSILON) {
    finalPrice =
      paidMeta.casePriceFromOps > 0
        ? paidMeta.casePriceFromOps
        : paidMeta.totalPaid + paidMeta.lastRemaining;
  }

  const totalPaid = paidMeta.totalPaid;
  const remaining =
    finalPrice > FINANCIAL_EPSILON
      ? Math.max(0, finalPrice - totalPaid)
      : paidMeta.lastRemaining;

  return { total: finalPrice, totalPaid, remaining };
}

function toSessionItems(ops: PatientOperation[]): CaseSessionItem[] {
  const chronological = sortOpsChronologically(ops);
  return chronological.map((op, index) => ({
    operation: op,
    date: sessionDateIso(op),
    amountPaid: num(op.paid_amount),
    sessionNumber: index + 1,
  }));
}

export interface BuildPatientCaseGroupsOptions {
  /** واجهة الطبيب — إخفاء سطور الدفع المنفصلة من القائمة الداخلية */
  clinicalSessionsOnly?: boolean;
  clinicalByOp?: ClinicalByOperationId;
}

/**
 * تجميع الجلسات والمدفوعات حسب case_id / اسم الحالة.
 * الملخص المالي يُحسب من جلسات كل حالة على حدة.
 */
export function buildPatientCaseGroups(
  operations: PatientOperation[],
  treatmentCases: PatientTreatmentCase[],
  options?: BuildPatientCaseGroupsOptions
): PatientCaseGroup[] {
  const rawGroups = groupOperationsByTreatmentCase(operations, treatmentCases);
  const representedCaseIds = new Set(
    rawGroups
      .map((g) => g.caseId)
      .filter((id): id is string => !!id && isPersistedTreatmentCaseId(id))
  );

  for (const c of treatmentCases) {
    if (!isPersistedTreatmentCaseId(c.id)) continue;
    if (representedCaseIds.has(c.id)) continue;
    if (computedCaseRemaining(c) <= FINANCIAL_EPSILON) continue;
    rawGroups.push({
      key: `case:${c.id}`,
      treatmentName: c.treatment_name_ar,
      caseId: c.id,
      caseInfo: c,
      sessions: [],
      sessionCount: 0,
    });
  }

  const groups: PatientCaseGroup[] = rawGroups.map((raw) => {
    const caseInfo = raw.caseInfo;
    const caseId = raw.caseId;
    const allCaseOps = raw.sessions;
    const financials = computeCaseFinancialsFromSessions(allCaseOps, caseInfo);

    const listOps =
      options?.clinicalSessionsOnly
        ? filterClinicalSessions(allCaseOps, options.clinicalByOp)
        : allCaseOps.filter((op) => op.session_kind !== "refund");

    const caseName = caseInfo
      ? treatmentCaseDisplayLabel(caseInfo, treatmentCases)
      : raw.treatmentName;

    const remaining = financials.remaining;
    const isComplete =
      caseInfo != null
        ? isTreatmentCaseComplete(caseInfo) && remaining <= FINANCIAL_EPSILON
        : remaining <= FINANCIAL_EPSILON && financials.totalPaid > 0;

    return {
      key: raw.key,
      caseId,
      caseName,
      total: financials.total,
      totalPaid: financials.totalPaid,
      remaining,
      sessions: toSessionItems(listOps),
      caseInfo,
      isComplete,
    };
  });

  return groups.sort((a, b) => {
    if (a.isComplete !== b.isComplete) return a.isComplete ? 1 : -1;
    if (a.remaining !== b.remaining) return b.remaining - a.remaining;
    return a.caseName.localeCompare(b.caseName, "ar");
  });
}

/** خريطة بمفتاح case_id أو key للاستخدام البرمجي */
export function buildPatientCaseGroupsMap(
  operations: PatientOperation[],
  treatmentCases: PatientTreatmentCase[],
  options?: BuildPatientCaseGroupsOptions
): PatientCaseGroupsMap {
  const groups = buildPatientCaseGroups(operations, treatmentCases, options);
  const map: PatientCaseGroupsMap = {};
  for (const g of groups) {
    const mapKey = g.caseId ?? g.key;
    map[mapKey] = g;
  }
  return map;
}

/** إجماليات مالية لمجموعة حالات (مثلاً حالات الطبيب فقط) */
export function sumCaseGroupsFinancials(groups: PatientCaseGroup[]): {
  totalPaid: number;
  totalRemaining: number;
  sessionCount: number;
} {
  return groups.reduce(
    (acc, g) => ({
      totalPaid: acc.totalPaid + g.totalPaid,
      totalRemaining: acc.totalRemaining + g.remaining,
      sessionCount: acc.sessionCount + g.sessions.length,
    }),
    { totalPaid: 0, totalRemaining: 0, sessionCount: 0 }
  );
}
