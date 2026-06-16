import type { SupabaseClient } from "@supabase/supabase-js";
import type { Patient, PatientOperation } from "@/types";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import {
  isPersistedTreatmentCaseId,
  type PatientTreatmentCase,
} from "@/lib/services/patient-treatment-cases";
import {
  PATIENT_SEARCH_MIN_LENGTH,
  type PatientSearchResult,
} from "@/lib/services/patient-search";

const PATIENT_SEARCH_COLUMNS =
  "id, clinic_id, full_name_ar, phone, phone_number, notes, created_at, updated_at";

/** معرّفات المراجعين المرتبطين بطبيب (أساسي / جلسات / خطط علاج) */
export async function getDoctorPatientIds(
  supabase: SupabaseClient,
  doctorId: string
): Promise<string[]> {
  const patientIds = new Set<string>();

  const [primaryRes, opsRes, casesRes, apptsRes] = await Promise.all([
    supabase.from("patients").select("id").eq("primary_doctor_id", doctorId),
    supabase
      .from("patient_operations")
      .select("patient_id")
      .eq("doctor_id", doctorId),
    supabase
      .from("patient_treatment_cases")
      .select("patient_id")
      .eq("primary_doctor_id", doctorId),
    supabase
      .from("appointments")
      .select("patient_id")
      .eq("doctor_id", doctorId)
      .not("patient_id", "is", null),
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
  for (const row of apptsRes.data ?? []) {
    if (row.patient_id) patientIds.add(String(row.patient_id));
  }

  return [...patientIds];
}

/** بحث مراجعين الطبيب بالاسم أو الهاتف — للواجهات ذات القوائم الكبيرة */
export async function searchPatientsForDoctor(
  supabase: SupabaseClient,
  clinicId: string,
  doctorId: string,
  query: string,
  opts: { limit?: number; minLength?: number } = {}
): Promise<{ patients: PatientSearchResult[]; error?: string }> {
  const q = query.trim();
  const minLength = opts.minLength ?? PATIENT_SEARCH_MIN_LENGTH;
  const limit = opts.limit ?? 20;

  if (q.length < minLength) {
    return { patients: [] };
  }

  const ids = await getDoctorPatientIds(supabase, doctorId);
  if (ids.length === 0) {
    return { patients: [] };
  }

  const { data, error } = await supabase
    .from("patients")
    .select(PATIENT_SEARCH_COLUMNS)
    .eq("clinic_id", clinicId)
    .in("id", ids)
    .ilike("full_name_ar", `%${q}%`)
    .order("full_name_ar")
    .limit(limit);

  if (error) {
    return { patients: [], error: error.message };
  }

  let patients = (data as PatientSearchResult[]) ?? [];

  if (patients.length === 0 && /^[\d+\s-]{4,}$/.test(q)) {
    const digits = q.replace(/\D/g, "");
    if (digits.length >= 4) {
      const { data: byPhone, error: phoneErr } = await supabase
        .from("patients")
        .select(PATIENT_SEARCH_COLUMNS)
        .eq("clinic_id", clinicId)
        .in("id", ids)
        .or(`phone.ilike.%${digits}%,phone_number.ilike.%${digits}%`)
        .limit(limit);
      if (phoneErr) {
        return { patients: [], error: phoneErr.message };
      }
      patients = (byPhone as PatientSearchResult[]) ?? [];
    }
  }

  return { patients };
}

/** مراجعون مرتبطون بطبيب معيّن فقط */
export async function fetchPatientsForDoctor(
  supabase: SupabaseClient,
  doctorId: string
): Promise<Patient[]> {
  const ids = await getDoctorPatientIds(supabase, doctorId);
  if (ids.length === 0) {
    return [];
  }

  const { data: merged } = await supabase
    .from("patients")
    .select("id, full_name_ar, phone, notes, updated_at")
    .in("id", ids)
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
  const ids = await getDoctorPatientIds(supabase, doctorId);
  return ids.includes(patientId);
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

/** حالات علاج مرتبطة بجلسات الطبيب فقط */
export function filterTreatmentCasesForDoctor(
  cases: PatientTreatmentCase[],
  doctorOperations: Pick<PatientOperation, "treatment_case_id">[]
): PatientTreatmentCase[] {
  const doctorCaseIds = new Set(
    doctorOperations
      .map((o) => o.treatment_case_id?.trim())
      .filter((id): id is string => !!id && isPersistedTreatmentCaseId(id))
  );
  return cases.filter((c) => doctorCaseIds.has(c.id));
}
