import type { SupabaseClient } from "@supabase/supabase-js";
import type { Patient } from "@/types";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";

/** مراجعون مرتبطون بطبيب معيّن فقط */
export async function fetchPatientsForDoctor(
  supabase: SupabaseClient,
  doctorId: string
): Promise<Patient[]> {
  const patientIds = new Set<string>();

  const [primaryRes, opsRes, casesRes] = await Promise.all([
    supabase
      .from("patients")
      .select("id, full_name_ar, phone, notes, updated_at")
      .eq("primary_doctor_id", doctorId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("patient_operations")
      .select("patient_id")
      .eq("doctor_id", doctorId),
    supabase
      .from("patient_treatment_cases")
      .select("patient_id")
      .eq("primary_doctor_id", doctorId),
  ]);

  for (const row of primaryRes.data ?? []) {
    patientIds.add(String(row.id));
  }
  for (const row of opsRes.data ?? []) {
    if (row.patient_id) patientIds.add(String(row.patient_id));
  }
  for (const row of casesRes.data ?? []) {
    if (row.patient_id) patientIds.add(String(row.patient_id));
  }

  if (patientIds.size === 0) {
    return (primaryRes.data as Patient[]) ?? [];
  }

  const { data: merged } = await supabase
    .from("patients")
    .select("id, full_name_ar, phone, notes, updated_at")
    .in("id", [...patientIds])
    .order("updated_at", { ascending: false });

  return (merged as Patient[]) ?? [];
}

export async function fetchPatientsForCurrentDoctor(
  supabase: SupabaseClient
): Promise<Patient[]> {
  const doctor = await getDoctorForCurrentUser(supabase);
  if (!doctor) return [];
  return fetchPatientsForDoctor(supabase, doctor.id);
}

export async function patientBelongsToDoctor(
  supabase: SupabaseClient,
  patientId: string,
  doctorId: string
): Promise<boolean> {
  const patients = await fetchPatientsForDoctor(supabase, doctorId);
  return patients.some((p) => p.id === patientId);
}

function caseBelongsToDoctor(
  caseRow: { primary_doctor_id?: string | null; id: string },
  caseOps: { doctor_id?: string }[],
  doctorId: string
): boolean {
  if (caseRow.primary_doctor_id) {
    return caseRow.primary_doctor_id === doctorId;
  }
  if (caseOps.length === 0) return false;
  return caseOps.some((o) => o.doctor_id === doctorId);
}

export { caseBelongsToDoctor };
