import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildPlanFromCaseRow,
  computedCaseRemaining,
} from "@/lib/services/patient-financial-plan";
import { opDebt, operationLabelForCase, type PatientOperation } from "@/types";
import { localPeriodUtcBounds, todayISO } from "@/lib/utils";

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export type TodayCaseInfo = {
  id: string;
  name: string;
  finalPrice: number;
  totalPaid: number;
  remaining: number;
  status: string;
};

export type TodayOperationRow = PatientOperation & {
  patient?: { full_name_ar: string };
  doctor?: { full_name_ar: string };
};

export function sessionKindLabel(kind: PatientOperation["session_kind"]): string {
  switch (kind) {
    case "plan":
      return "فتح حالة";
    case "payment":
      return "دفعة";
    case "discount":
      return "خصم";
    case "refund":
      return "استرداد";
    default:
      return "جلسة";
  }
}

/** حلّ معرّف الحالة — من الجلسة أو أحدث حالة نشطة للمراجع */
export function resolveOperationCaseId(
  op: PatientOperation,
  patientPrimaryCaseId: Map<string, string>
): string | null {
  const direct = op.treatment_case_id?.trim();
  if (direct) return direct;
  const patientId = op.patient_id?.trim();
  if (!patientId) return null;
  return patientPrimaryCaseId.get(patientId) ?? null;
}

export function ledgerCaseName(
  op: PatientOperation,
  caseInfoById: Map<string, TodayCaseInfo>,
  patientPrimaryCaseId: Map<string, string>
): string {
  const caseId = resolveOperationCaseId(op, patientPrimaryCaseId);
  if (caseId && caseInfoById.has(caseId)) {
    return caseInfoById.get(caseId)!.name;
  }
  return operationLabelForCase(op);
}

export function ledgerPaidToday(op: PatientOperation): number {
  return Math.max(0, num(op.paid_amount));
}

/** المتبقي المعروض في جدول جلسات اليوم — ذمة الحالة إن وُجدت */
export function ledgerDisplayRemaining(
  op: PatientOperation,
  caseRemainingById: Map<string, number>,
  patientPrimaryCaseId: Map<string, string> = new Map()
): number {
  const caseId = resolveOperationCaseId(op, patientPrimaryCaseId);
  if (caseId && caseRemainingById.has(caseId)) {
    return Math.max(0, caseRemainingById.get(caseId)!);
  }
  if (op.session_kind === "payment" && op.total_amount <= 0) {
    return 0;
  }
  return opDebt(op);
}

function buildCaseInfoFromRow(row: Record<string, unknown>): TodayCaseInfo {
  const casePrice = num(row.case_price);
  const discount = num(row.discount_total);
  const finalPrice =
    num(row.final_price) || Math.max(0, casePrice - discount);
  const plan = buildPlanFromCaseRow({
    case_price: casePrice,
    discount_total: discount,
    final_price: finalPrice,
    doctor_share_total: num(row.doctor_share_total),
    clinic_share_total: num(row.clinic_share_total),
    total_paid: num(row.total_paid),
  });
  const remaining = computedCaseRemaining(plan);
  return {
    id: String(row.id),
    name: String(row.treatment_name_ar ?? "علاج").trim() || "علاج",
    finalPrice,
    totalPaid: num(row.total_paid),
    remaining,
    status: String(row.treatment_status ?? row.status ?? "active"),
  };
}

export type LedgerOperationsFilters = {
  date?: string;
  doctorId?: string;
  limit?: number;
};

export async function fetchLedgerOperationsForDate(
  supabase: SupabaseClient,
  clinicId: string,
  filters: LedgerOperationsFilters = {}
): Promise<{
  operations: TodayOperationRow[];
  caseRemainingById: Map<string, number>;
  caseInfoById: Map<string, TodayCaseInfo>;
  patientPrimaryCaseId: Map<string, string>;
}> {
  const date = filters.date ?? todayISO();
  const limit = filters.limit ?? 500;
  const { startIso, endIso } = localPeriodUtcBounds(date, date);

  const selectCols =
    "*, patient:patients!patient_id(full_name_ar), doctor:doctors!doctor_id(full_name_ar)";

  let byOpDateQuery = supabase
    .from("patient_operations")
    .select(selectCols)
    .eq("clinic_id", clinicId)
    .eq("operation_date", date)
    .or("invoice_status.neq.archived,invoice_status.is.null")
    .order("created_at", { ascending: false })
    .limit(limit);

  let byCreatedQuery = supabase
    .from("patient_operations")
    .select(selectCols)
    .eq("clinic_id", clinicId)
    .gte("created_at", startIso)
    .lte("created_at", endIso)
    .or("invoice_status.neq.archived,invoice_status.is.null")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (filters.doctorId) {
    byOpDateQuery = byOpDateQuery.eq("doctor_id", filters.doctorId);
    byCreatedQuery = byCreatedQuery.eq("doctor_id", filters.doctorId);
  }

  const [byOpDateRes, byCreatedRes] = await Promise.all([
    byOpDateQuery,
    byCreatedQuery,
  ]);

  const mergedById = new Map<string, TodayOperationRow>();
  for (const row of [...(byOpDateRes.data ?? []), ...(byCreatedRes.data ?? [])]) {
    const op = row as TodayOperationRow;
    if (op.invoice_status === "archived") continue;
    mergedById.set(op.id, op);
  }

  const operations = [...mergedById.values()].sort((a, b) =>
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
  );

  const patientIds = [
    ...new Set(
      operations
        .map((op) => op.patient_id)
        .filter((id): id is string => !!id && id.length > 0)
    ),
  ];

  const patientPrimaryCaseId = new Map<string, string>();
  const allCaseIds = new Set(
    operations
      .map((op) => op.treatment_case_id)
      .filter((id): id is string => !!id && id.length > 0)
  );

  if (patientIds.length > 0) {
    const { data: patientCases } = await supabase
      .from("patient_treatment_cases")
      .select(
        "id, patient_id, treatment_name_ar, case_price, discount_total, final_price, total_paid, doctor_share_total, clinic_share_total, treatment_status, status"
      )
      .eq("clinic_id", clinicId)
      .in("patient_id", patientIds)
      .order("created_at", { ascending: false });

    for (const row of patientCases ?? []) {
      const r = row as Record<string, unknown>;
      const patientId = String(r.patient_id ?? "");
      const caseId = String(r.id ?? "");
      const status = String(r.treatment_status ?? r.status ?? "active");
      if (!patientId || !caseId) continue;

      allCaseIds.add(caseId);

      if (status === "completed") continue;
      if (!patientPrimaryCaseId.has(patientId)) {
        patientPrimaryCaseId.set(patientId, caseId);
      }
    }
  }

  const caseRemainingById = new Map<string, number>();
  const caseInfoById = new Map<string, TodayCaseInfo>();

  if (allCaseIds.size > 0) {
    const { data: cases } = await supabase
      .from("patient_treatment_cases")
      .select(
        "id, treatment_name_ar, case_price, discount_total, final_price, total_paid, doctor_share_total, clinic_share_total, treatment_status, status"
      )
      .in("id", [...allCaseIds]);

    for (const row of cases ?? []) {
      const info = buildCaseInfoFromRow(row as Record<string, unknown>);
      caseInfoById.set(info.id, info);
      caseRemainingById.set(info.id, info.remaining);
    }
  }

  return { operations, caseRemainingById, caseInfoById, patientPrimaryCaseId };
}

export async function fetchTodayLedgerOperations(
  supabase: SupabaseClient,
  clinicId: string
): Promise<{
  operations: TodayOperationRow[];
  caseRemainingById: Map<string, number>;
  caseInfoById: Map<string, TodayCaseInfo>;
  patientPrimaryCaseId: Map<string, string>;
}> {
  return fetchLedgerOperationsForDate(supabase, clinicId, { date: todayISO() });
}
