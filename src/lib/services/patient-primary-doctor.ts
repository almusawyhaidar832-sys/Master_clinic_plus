import type { SupabaseClient } from "@supabase/supabase-js";

export interface PatientPrimaryDoctor {
  id: string;
  full_name_ar: string;
}

/** آخر طبيب سجّلت لهذا المريض جلسة — يُستخدم تلقائياً للمتابعة والحالات الجديدة */
export async function fetchPatientPrimaryDoctor(
  supabase: SupabaseClient,
  patientId: string
): Promise<PatientPrimaryDoctor | null> {
  const { data, error } = await supabase
    .from("patient_operations")
    .select("doctor_id, doctor:doctors!doctor_id(full_name_ar)")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.doctor_id) return null;

  const doc = data.doctor as { full_name_ar?: string } | null;
  return {
    id: String(data.doctor_id),
    full_name_ar: doc?.full_name_ar?.trim() || "الطبيب",
  };
}
