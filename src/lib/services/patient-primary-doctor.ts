import type { SupabaseClient } from "@supabase/supabase-js";

export interface PatientPrimaryDoctor {
  id: string;
  full_name_ar: string;
}

function mapDoctorRow(
  doctorId: string,
  doc: { full_name_ar?: string } | null
): PatientPrimaryDoctor {
  return {
    id: doctorId,
    full_name_ar: doc?.full_name_ar?.trim() || "الطبيب",
  };
}

/** الطبيب المعالج لحالة محددة */
export async function fetchCasePrimaryDoctor(
  supabase: SupabaseClient,
  caseId: string
): Promise<PatientPrimaryDoctor | null> {
  const { data: caseRow, error: caseErr } = await supabase
    .from("patient_treatment_cases")
    .select("primary_doctor_id, doctor:doctors!primary_doctor_id(full_name_ar)")
    .eq("id", caseId)
    .maybeSingle();

  if (!caseErr && caseRow?.primary_doctor_id) {
    return mapDoctorRow(
      String(caseRow.primary_doctor_id),
      caseRow.doctor as { full_name_ar?: string } | null
    );
  }

  const { data: op, error: opErr } = await supabase
    .from("patient_operations")
    .select("doctor_id, doctor:doctors!doctor_id(full_name_ar)")
    .eq("treatment_case_id", caseId)
    .neq("session_kind", "refund")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (opErr || !op?.doctor_id) return null;

  return mapDoctorRow(
    String(op.doctor_id),
    op.doctor as { full_name_ar?: string } | null
  );
}

/** الطبيب المعالج الحالي للمراجع — للحالات الجديدة بدون حالة محددة */
export async function fetchPatientPrimaryDoctor(
  supabase: SupabaseClient,
  patientId: string
): Promise<PatientPrimaryDoctor | null> {
  const { data: patient, error: patientErr } = await supabase
    .from("patients")
    .select("primary_doctor_id, doctor:doctors!primary_doctor_id(full_name_ar)")
    .eq("id", patientId)
    .maybeSingle();

  if (!patientErr && patient?.primary_doctor_id) {
    return mapDoctorRow(
      String(patient.primary_doctor_id),
      patient.doctor as { full_name_ar?: string } | null
    );
  }

  const { data, error } = await supabase
    .from("patient_operations")
    .select("doctor_id, doctor:doctors!doctor_id(full_name_ar)")
    .eq("patient_id", patientId)
    .neq("session_kind", "refund")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.doctor_id) return null;

  return mapDoctorRow(
    String(data.doctor_id),
    data.doctor as { full_name_ar?: string } | null
  );
}
