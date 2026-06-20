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

export async function fetchTodayLedgerOperations(
  supabase: SupabaseClient,
  clinicId: string
): Promise<{
  operations: TodayOperationRow[];
  caseRemainingById: Map<string, number>;
  caseInfoById: Map<string, TodayCaseInfo>;
  patientPrimaryCaseId: Map<string, string>;
}> {
  const today = todayISO();
  const { startIso, endIso } = localPeriodUtcBounds(today, today);

  const opsQuery = supabase
    .from("patient_operations")
    .select(
      "*, patient:patients!patient_id(full_name_ar), doctor:doctors!doctor_id(full_name_ar)"
    )
    .eq("clinic_id", clinicId)
    .eq("operation_date", today)
    .or("invoice_status.neq.archived,invoice_status.is.null")
    .order("created_at", { ascending: false })
    .limit(100);

  let { data } = await opsQuery;

  if (!data?.length) {
    const fallback = await supabase
      .from("patient_operations")
      .select(
        "*, patient:patients!patient_id(full_name_ar), doctor:doctors!doctor_id(full_name_ar)"
      )
      .eq("clinic_id", clinicId)
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .or("invoice_status.neq.archived,invoice_status.is.null")
      .order("created_at", { ascending: false })
      .limit(100);
    data = fallback.data;
  }

  const operations = ((data ?? []) as TodayOperationRow[]).filter(
    (op) => op.invoice_status !== "archived"
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
      const status = String(r.treatment_status ?? r.status ?? "active");
      if (!patientId || status === "completed") continue;
      if (!patientPrimaryCaseId.has(patientId)) {
        patientPrimaryCaseId.set(patientId, String(r.id));
        allCaseIds.add(String(r.id));
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
