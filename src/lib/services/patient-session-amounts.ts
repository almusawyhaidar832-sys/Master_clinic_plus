import type { SupabaseClient } from "@supabase/supabase-js";

/** Last billed total for patient — column previous_total or latest operation */
export async function fetchPatientPreviousTotal(
  supabase: SupabaseClient,
  patientId: string
): Promise<number> {
  const { data: patient, error } = await supabase
    .from("patients")
    .select("previous_total")
    .eq("id", patientId)
    .maybeSingle();

  if (!error && patient) {
    const agreed = Number(
      (patient as { agreed_total?: number }).agreed_total ?? 0
    );
    if (agreed > 0) return agreed;
    if (
      "previous_total" in patient &&
      patient.previous_total != null
    ) {
      const v = Number(patient.previous_total);
      if (v > 0) return v;
    }
  }

  const { data: lastOp } = await supabase
    .from("patient_operations")
    .select("total_amount")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return Math.max(0, Number(lastOp?.total_amount ?? 0));
}

export async function updatePatientPreviousTotal(
  supabase: SupabaseClient,
  patientId: string,
  totalAmount: number
): Promise<void> {
  const { error } = await supabase
    .from("patients")
    .update({ previous_total: totalAmount })
    .eq("id", patientId);

  if (error && !error.message.includes("previous_total")) {
    console.warn("[patient-session-amounts] update previous_total:", error.message);
  }
}

/** Resolve total for insert: manual entry wins, else previous_total from DB */
export function resolveSessionTotalAmount(
  manualInput: string,
  previousTotal: number
): { total: number; source: "manual" | "previous_total" | "zero" } {
  const trimmed = manualInput.trim();
  if (trimmed !== "") {
    const manual = parseFloat(trimmed);
    if (!Number.isNaN(manual) && manual >= 0) {
      return { total: manual, source: "manual" };
    }
  }
  if (previousTotal > 0) {
    return { total: previousTotal, source: "previous_total" };
  }
  return { total: 0, source: "zero" };
}
