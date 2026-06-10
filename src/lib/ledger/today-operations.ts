import type { SupabaseClient } from "@supabase/supabase-js";
import {
  caseToFinancialPlan,
  computedCaseRemaining,
  type PatientTreatmentCase,
} from "@/lib/services/patient-treatment-cases";
import { opDebt, type PatientOperation } from "@/types";
import { localPeriodUtcBounds, todayISO } from "@/lib/utils";

export type TodayOperationRow = PatientOperation & {
  patient?: { full_name_ar: string };
  doctor?: { full_name_ar: string };
};

/** المتبقي المعروض في جدول جلسات اليوم — ذمة الحالة إن وُجدت */
export function ledgerDisplayRemaining(
  op: PatientOperation,
  caseRemainingById: Map<string, number>
): number {
  const caseId = op.treatment_case_id;
  if (caseId && caseRemainingById.has(caseId)) {
    return Math.max(0, caseRemainingById.get(caseId)!);
  }
  return opDebt(op);
}

export async function fetchTodayLedgerOperations(
  supabase: SupabaseClient,
  clinicId: string
): Promise<{
  operations: TodayOperationRow[];
  caseRemainingById: Map<string, number>;
}> {
  const today = todayISO();
  const { startIso, endIso } = localPeriodUtcBounds(today, today);

  let opsQuery = supabase
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
  const caseIds = [
    ...new Set(
      operations
        .map((op) => op.treatment_case_id)
        .filter((id): id is string => !!id && id.length > 0)
    ),
  ];

  const caseRemainingById = new Map<string, number>();
  if (caseIds.length > 0) {
    const { data: cases } = await supabase
      .from("patient_treatment_cases")
      .select(
        "id, treatment_name_ar, case_price, discount_total, final_price, total_paid, remaining_balance, treatment_status, financial_locked, original_agreed_total, doctor_share_total, clinic_share_total"
      )
      .in("id", caseIds);

    for (const row of cases ?? []) {
      const rem = computedCaseRemaining(
        caseToFinancialPlan(row as PatientTreatmentCase)
      );
      caseRemainingById.set(row.id as string, rem);
    }
  }

  return { operations, caseRemainingById };
}
