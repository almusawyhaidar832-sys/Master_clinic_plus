import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildPatientCaseGroups,
  type PatientCaseGroup,
} from "@/lib/services/patient-case-groups";
import { fetchPatientTreatmentCases } from "@/lib/services/patient-treatment-cases";
import type { PatientTreatmentCase } from "@/lib/services/patient-treatment-cases";
import type { PatientOperation } from "@/types";

/** جلسات + طبيب + فواتير/مدفوعات مرتبطة (invoices.operation_id) */
export const PATIENT_OPERATIONS_PROFILE_SELECT = `
  *,
  doctor:doctors!doctor_id(full_name_ar),
  invoices(paid_amount, total_amount, remaining_amount)
`;

export type PatientOperationProfileRow = PatientOperation & {
  doctor?: { full_name_ar: string } | null;
  invoices?: { paid_amount: number; total_amount: number; remaining_amount: number }[] | null;
};

/** المبلغ المسجّل فعلياً للجلسة — من patient_operations أو مجموع الفاتورة */
export function resolveSessionPaidAmount(
  op: Pick<PatientOperationProfileRow, "paid_amount" | "invoices">
): number {
  const fromOp = Number(op.paid_amount ?? 0);
  const fromInvoices = (op.invoices ?? []).reduce(
    (sum, inv) => sum + Number(inv.paid_amount ?? 0),
    0
  );
  return Math.max(fromOp, fromInvoices);
}

function normalizeOperationRow(row: PatientOperationProfileRow): PatientOperation {
  const { invoices: _invoices, ...rest } = row;
  const paid = resolveSessionPaidAmount(row);
  return {
    ...rest,
    paid_amount: paid,
    doctor: row.doctor ?? undefined,
  } as PatientOperation & { doctor?: { full_name_ar: string } };
}

export async function fetchPatientOperationsForProfile(
  supabase: SupabaseClient,
  patientId: string,
  opts?: { clinicId?: string; doctorId?: string }
): Promise<PatientOperation[]> {
  let query = supabase
    .from("patient_operations")
    .select(PATIENT_OPERATIONS_PROFILE_SELECT)
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (opts?.clinicId) {
    query = query.eq("clinic_id", opts.clinicId);
  }
  if (opts?.doctorId) {
    query = query.eq("doctor_id", opts.doctorId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as PatientOperationProfileRow[]).map(normalizeOperationRow);
}

export interface PatientProfileSessionsBundle {
  operations: PatientOperation[];
  treatmentCases: PatientTreatmentCase[];
  caseGroups: PatientCaseGroup[];
}

/** جلب الجلسات + الحالات + تجميع حسب case_id */
export async function fetchPatientProfileSessionsBundle(
  supabase: SupabaseClient,
  patientId: string,
  opts?: {
    clinicId?: string;
    doctorId?: string;
    clinicalSessionsOnly?: boolean;
  }
): Promise<PatientProfileSessionsBundle> {
  const [operations, treatmentCases] = await Promise.all([
    fetchPatientOperationsForProfile(supabase, patientId, {
      clinicId: opts?.clinicId,
      doctorId: opts?.doctorId,
    }),
    fetchPatientTreatmentCases(supabase, patientId, opts?.clinicId),
  ]);

  const caseGroups = buildPatientCaseGroups(operations, treatmentCases, {
    clinicalSessionsOnly: opts?.clinicalSessionsOnly,
  });

  return { operations, treatmentCases, caseGroups };
}
