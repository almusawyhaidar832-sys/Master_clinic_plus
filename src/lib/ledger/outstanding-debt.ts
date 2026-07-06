import type { SupabaseClient } from "@supabase/supabase-js";
import { FINANCIAL_EPSILON } from "@/lib/services/patient-financial-plan";
import type { TodayCaseInfo } from "@/lib/ledger/today-operations";
import { getPatientDisplayPhone } from "@/lib/phone";
import type { Patient } from "@/types";

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export type DebtorCaseDetail = {
  caseId: string;
  treatmentName: string;
  totalPaid: number;
  debt: number;
};

export type ClinicDebtorRow = {
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  totalDebt: number;
  cases: DebtorCaseDetail[];
};

function caseDebtFromRow(row: Record<string, unknown>): number {
  const status = String(row.status ?? row.treatment_status ?? "active");
  if (status === "completed") return 0;

  const casePrice = num(row.case_price);
  const discount = num(row.discount_total);
  const finalPrice =
    num(row.final_price) || Math.max(0, casePrice - discount);
  if (finalPrice <= FINANCIAL_EPSILON) return 0;

  return Math.max(0, finalPrice - num(row.total_paid));
}

/** كل المراجعين الذين عليهم دين مسجّل — للإدارة والمحاسب */
export async function fetchClinicDebtors(
  supabase: SupabaseClient,
  clinicId: string,
  input?: { doctorId?: string; limit?: number }
): Promise<ClinicDebtorRow[]> {
  let query = supabase
    .from("patient_treatment_cases")
    .select(
      "id, patient_id, treatment_name_ar, case_price, discount_total, final_price, total_paid, status, primary_doctor_id, patient:patients!patient_id(id, full_name_ar, phone, phone_e164)"
    )
    .eq("clinic_id", clinicId)
    .neq("status", "completed")
    .order("updated_at", { ascending: false });

  if (input?.doctorId) {
    query = query.eq("primary_doctor_id", input.doctorId);
  }

  const limit = input?.limit ?? 200;
  query = query.limit(limit);

  const { data } = await query;
  const byPatient = new Map<string, ClinicDebtorRow>();

  for (const row of data ?? []) {
    const r = row as Record<string, unknown>;
    const debt = caseDebtFromRow(r);
    if (debt <= FINANCIAL_EPSILON) continue;

    const patientId = String(r.patient_id ?? "");
    if (!patientId) continue;

    const patientRaw = r.patient;
    const patient =
      patientRaw && typeof patientRaw === "object" && !Array.isArray(patientRaw)
        ? (patientRaw as Patient)
        : Array.isArray(patientRaw) && patientRaw[0]
          ? (patientRaw[0] as Patient)
          : null;

    const existing = byPatient.get(patientId);
    const caseDetail: DebtorCaseDetail = {
      caseId: String(r.id),
      treatmentName: String(r.treatment_name_ar ?? "علاج").trim() || "علاج",
      totalPaid: num(r.total_paid),
      debt,
    };

    if (existing) {
      existing.cases.push(caseDetail);
      existing.totalDebt += debt;
    } else {
      byPatient.set(patientId, {
        patientId,
        patientName: patient?.full_name_ar?.trim() || "مراجع",
        patientPhone: patient ? getPatientDisplayPhone(patient) : null,
        totalDebt: debt,
        cases: [caseDetail],
      });
    }
  }

  return [...byPatient.values()].sort((a, b) => {
    if (b.totalDebt !== a.totalDebt) return b.totalDebt - a.totalDebt;
    return a.patientName.localeCompare(b.patientName, "ar");
  });
}

/** مجموع دين مراجع من حالاته في كشف اليوم */
export function sumPatientDebtFromCases(
  caseInfoById: Map<string, TodayCaseInfo>
): Map<string, { total: number; cases: { name: string; remaining: number }[] }> {
  const map = new Map<
    string,
    { total: number; cases: { name: string; remaining: number }[] }
  >();

  for (const info of caseInfoById.values()) {
    const patientId = info.patientId?.trim();
    if (!patientId || info.remaining <= FINANCIAL_EPSILON) continue;

    const entry = map.get(patientId) ?? { total: 0, cases: [] };
    entry.total += info.remaining;
    entry.cases.push({ name: info.name, remaining: info.remaining });
    map.set(patientId, entry);
  }

  return map;
}
