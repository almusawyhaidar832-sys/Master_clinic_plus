import type { SupabaseClient } from "@supabase/supabase-js";
import type { Patient, PatientOperation } from "@/types";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import {
  isPersistedTreatmentCaseId,
  type PatientTreatmentCase,
} from "@/lib/services/patient-treatment-cases";
import {
  enrichPatientSearchWithDoctors,
  PATIENT_SEARCH_MIN_LENGTH,
  type PatientSearchResult,
} from "@/lib/services/patient-search";
import {
  fetchAllRows,
  fetchAllRowsInChunks,
} from "@/lib/supabase/fetch-all-rows";

const PATIENT_SEARCH_COLUMNS =
  "id, clinic_id, full_name_ar, phone, phone_number, notes, primary_doctor_id, created_at, updated_at";

/** معرّفات المراجعين المرتبطين بطبيب (أساسي / جلسات / خطط علاج) */
export async function getDoctorPatientIds(
  supabase: SupabaseClient,
  doctorId: string
): Promise<string[]> {
  const patientIds = new Set<string>();

  type IdRow = { id?: string; patient_id?: string | null };
  const [primaryRes, opsRes, casesRes, apptsRes] = await Promise.all([
    fetchAllRows<IdRow>(() =>
      supabase
        .from("patients")
        .select("id")
        .eq("primary_doctor_id", doctorId)
        .order("id", { ascending: true })
    ),
    fetchAllRows<IdRow>(() =>
      supabase
        .from("patient_operations")
        .select("id, patient_id")
        .eq("doctor_id", doctorId)
        .order("id", { ascending: true })
    ),
    fetchAllRows<IdRow>(() =>
      supabase
        .from("patient_treatment_cases")
        .select("id, patient_id")
        .eq("primary_doctor_id", doctorId)
        .order("id", { ascending: true })
    ),
    fetchAllRows<IdRow>(() =>
      supabase
        .from("appointments")
        .select("id, patient_id")
        .eq("doctor_id", doctorId)
        .not("patient_id", "is", null)
        .order("id", { ascending: true })
    ),
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

  const { data, error } = await fetchAllRowsInChunks<PatientSearchResult>(
    ids,
    (chunk) =>
      supabase
        .from("patients")
        .select(PATIENT_SEARCH_COLUMNS)
        .eq("clinic_id", clinicId)
        .in("id", chunk)
        .ilike("full_name_ar", `%${q}%`)
        .order("full_name_ar")
        .order("id", { ascending: true })
  );

  if (error) {
    return { patients: [], error: error.message };
  }

  let patients = [...(data ?? [])]
    .sort((a, b) =>
      String(a.full_name_ar ?? "").localeCompare(String(b.full_name_ar ?? ""))
    )
    .slice(0, limit);

  if (patients.length === 0 && /^[\d+\s-]{4,}$/.test(q)) {
    const digits = q.replace(/\D/g, "");
    if (digits.length >= 4) {
      const { data: byPhone, error: phoneErr } =
        await fetchAllRowsInChunks<PatientSearchResult>(ids, (chunk) =>
          supabase
            .from("patients")
            .select(PATIENT_SEARCH_COLUMNS)
            .eq("clinic_id", clinicId)
            .in("id", chunk)
            .or(`phone.ilike.%${digits}%,phone_number.ilike.%${digits}%`)
            .order("id", { ascending: true })
        );
      if (phoneErr) {
        return { patients: [], error: phoneErr.message };
      }
      patients = (byPhone ?? []).slice(0, limit);
    }
  }

  patients = await enrichPatientSearchWithDoctors(supabase, patients);

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

  const { data: merged } = await fetchAllRowsInChunks<
    Patient & { updated_at?: string | null }
  >(ids, (chunk) =>
    supabase
      .from("patients")
      .select("id, full_name_ar, phone, notes, updated_at")
      .in("id", chunk)
      .order("id", { ascending: true })
  );

  return [...(merged ?? [])].sort((a, b) =>
    String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""))
  );
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
