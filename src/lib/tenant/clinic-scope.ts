import type { SupabaseClient } from "@supabase/supabase-js";

/** يطبّق فلتر العيادة على استعلام Supabase — لا يُرجع بيانات بدون clinic_id */
export function withClinicId<T extends { eq: (col: string, val: string) => T }>(
  query: T,
  clinicId: string | null | undefined,
  column = "clinic_id"
): T | null {
  if (!clinicId?.trim()) return null;
  return query.eq(column, clinicId);
}

export function sameClinic(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  return Boolean(a && b && a === b);
}

/** تحقق أن المريض/المورد ينتمي لعيادة الجلسة */
export async function fetchPatientInClinic(
  supabase: SupabaseClient,
  patientId: string,
  clinicId: string
): Promise<{ id: string; clinic_id: string } | null> {
  const { data } = await supabase
    .from("patients")
    .select("id, clinic_id")
    .eq("id", patientId)
    .eq("clinic_id", clinicId)
    .maybeSingle();
  return data as { id: string; clinic_id: string } | null;
}
