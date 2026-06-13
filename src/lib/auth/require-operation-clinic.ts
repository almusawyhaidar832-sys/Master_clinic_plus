import { getAdminClient } from "@/lib/supabase/admin";

/** Verify a patient_operations row belongs to the caller's clinic. */
export async function assertOperationInClinic(
  operationId: string,
  clinicId: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const admin = getAdminClient();
  const { data: op } = await admin
    .from("patient_operations")
    .select("id, clinic_id")
    .eq("id", operationId)
    .maybeSingle();

  if (!op || op.clinic_id !== clinicId) {
    return { ok: false, status: 404, error: "الجلسة غير موجودة" };
  }

  return { ok: true };
}
