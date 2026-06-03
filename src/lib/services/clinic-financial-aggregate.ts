import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Profit shares are stored once on `patients` (agreed_total plan).
 * Payment sessions have clinic_share_amount = 0 — do not sum them.
 */
export async function fetchTreatmentLevelShares(
  supabase: SupabaseClient
): Promise<{ clinicShareTotal: number; doctorShareTotal: number }> {
  const { data: patients } = await supabase
    .from("patients")
    .select("id, agreed_total, clinic_share_total, doctor_share_total");

  let clinicShareTotal = 0;
  let doctorShareTotal = 0;
  const patientsWithPlan = new Set<string>();

  for (const p of patients ?? []) {
    const agreed = Number(p.agreed_total ?? 0);
    if (agreed > 0) {
      patientsWithPlan.add(p.id as string);
      clinicShareTotal += Number(p.clinic_share_total ?? 0);
      doctorShareTotal += Number(p.doctor_share_total ?? 0);
    }
  }

  const { data: legacyOps } = await supabase
    .from("patient_operations")
    .select("patient_id, clinic_share_amount, doctor_share_amount");

  for (const op of legacyOps ?? []) {
    const pid = op.patient_id as string;
    if (patientsWithPlan.has(pid)) continue;
    clinicShareTotal += Number(op.clinic_share_amount ?? 0);
    doctorShareTotal += Number(op.doctor_share_amount ?? 0);
  }

  return { clinicShareTotal, doctorShareTotal };
}

export async function fetchOutstandingDebts(
  supabase: SupabaseClient
): Promise<number> {
  const { data: patients } = await supabase
    .from("patients")
    .select("id, agreed_total, total_paid");

  let debt = 0;
  const patientsWithPlan = new Set<string>();

  for (const p of patients ?? []) {
    const agreed = Number(p.agreed_total ?? 0);
    if (agreed > 0) {
      patientsWithPlan.add(p.id as string);
      debt += Math.max(0, agreed - Number(p.total_paid ?? 0));
    }
  }

  const { data: legacyOps } = await supabase
    .from("patient_operations")
    .select("patient_id, remaining_debt")
    .gt("remaining_debt", 0);

  for (const op of legacyOps ?? []) {
    if (patientsWithPlan.has(op.patient_id as string)) continue;
    debt += Number(op.remaining_debt ?? 0);
  }

  return debt;
}
