import type { SupabaseClient } from "@supabase/supabase-js";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import { getActiveClinicId } from "@/lib/clinic-context";
import type { Patient } from "@/types";

const PATIENT_SEARCH_COLUMNS =
  "id, clinic_id, full_name_ar, phone, phone_number, notes, primary_doctor_id, created_at, updated_at";

export type PatientSearchResult = Pick<
  Patient,
  "id" | "clinic_id" | "full_name_ar" | "phone" | "notes"
> & {
  phone_number?: string | null;
  primary_doctor_id?: string | null;
  /** الطبيب المعالج أو آخر طبيب عمل مع المراجع */
  primary_doctor_name?: string | null;
  created_at?: string;
  updated_at?: string;
};

export const PATIENT_SEARCH_MIN_LENGTH = 2;
export const PATIENT_SEARCH_DEBOUNCE_MS = 300;

/** clinic = كل مراجعي العيادة؛ doctor = مراجعو الطبيب فقط */
export type PatientSearchScope = "clinic" | "doctor";

export async function enrichPatientSearchWithDoctors(
  supabase: SupabaseClient,
  patients: PatientSearchResult[]
): Promise<PatientSearchResult[]> {
  if (patients.length === 0) return patients;

  const doctorIds = new Set<string>();
  const needsFallback: string[] = [];

  for (const p of patients) {
    if (p.primary_doctor_id) {
      doctorIds.add(p.primary_doctor_id);
    } else {
      needsFallback.push(p.id);
    }
  }

  const fallbackDoctorByPatient = new Map<string, string>();

  if (needsFallback.length > 0) {
    const { data: ops } = await supabase
      .from("patient_operations")
      .select("patient_id, doctor_id, created_at")
      .in("patient_id", needsFallback)
      .order("created_at", { ascending: false });

    for (const op of ops ?? []) {
      const pid = String(op.patient_id);
      const did = String(op.doctor_id ?? "");
      if (!did || fallbackDoctorByPatient.has(pid)) continue;
      fallbackDoctorByPatient.set(pid, did);
      doctorIds.add(did);
    }
  }

  if (doctorIds.size === 0) return patients;

  const { data: doctors } = await supabase
    .from("doctors")
    .select("id, full_name_ar")
    .in("id", [...doctorIds]);

  const doctorNameById = new Map<string, string>();
  for (const d of doctors ?? []) {
    doctorNameById.set(String(d.id), String(d.full_name_ar ?? "").trim());
  }

  return patients.map((p) => {
    const doctorId =
      p.primary_doctor_id ?? fallbackDoctorByPatient.get(p.id) ?? null;
    return {
      ...p,
      primary_doctor_id: doctorId,
      primary_doctor_name: doctorId
        ? doctorNameById.get(doctorId) ?? null
        : null,
    };
  });
}

/** Core DB search — clinic_id must be known */
export async function searchPatientsInClinic(
  supabase: SupabaseClient,
  clinicId: string,
  query: string,
  opts: { limit?: number; minLength?: number } = {}
): Promise<{ patients: PatientSearchResult[]; error?: string }> {
  const q = query.trim();
  const minLength = opts.minLength ?? PATIENT_SEARCH_MIN_LENGTH;
  const limit = opts.limit ?? 30;

  if (q.length < minLength) {
    return { patients: [] };
  }

  const { data, error } = await supabase
    .from("patients")
    .select(PATIENT_SEARCH_COLUMNS)
    .eq("clinic_id", clinicId)
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
        .or(`phone.ilike.%${digits}%,phone_number.ilike.%${digits}%`)
        .limit(limit);
      if (phoneErr) {
        return { patients: [], error: phoneErr.message };
      }
      patients = (byPhone as PatientSearchResult[]) ?? [];
    }
  }

  patients = await enrichPatientSearchWithDoctors(supabase, patients);

  return { patients };
}

export async function searchPatientsByQuery(
  supabase: SupabaseClient,
  query: string,
  opts: { limit?: number; minLength?: number; clinicId?: string } = {}
): Promise<{ patients: PatientSearchResult[]; error?: string }> {
  const q = query.trim();
  const minLength = opts.minLength ?? PATIENT_SEARCH_MIN_LENGTH;

  if (q.length < minLength) {
    return { patients: [] };
  }

  const activeClinic = opts.clinicId
    ? { clinicId: opts.clinicId }
    : await getActiveClinicId(supabase);

  if (!activeClinic?.clinicId) {
    return {
      patients: [],
      error: "حسابك غير مربوط بعيادة — تواصل مع الإدارة",
    };
  }

  return searchPatientsInClinic(supabase, activeClinic.clinicId, q, opts);
}

/** Live search via API — reliable session + clinic scoping */
export async function searchPatientsViaApi(
  query: string,
  opts: {
    portal: AuthPortalId;
    limit?: number;
    minLength?: number;
    signal?: AbortSignal;
    scope?: PatientSearchScope;
    doctorId?: string | null;
  }
): Promise<{ patients: PatientSearchResult[]; error?: string }> {
  const q = query.trim();
  const minLength = opts.minLength ?? PATIENT_SEARCH_MIN_LENGTH;
  const limit = opts.limit ?? 20;

  if (q.length < minLength) {
    return { patients: [] };
  }

  try {
    const params = new URLSearchParams({
      q,
      limit: String(limit),
    });
    if (opts.scope) {
      params.set("scope", opts.scope);
    }
    if (opts.doctorId) {
      params.set("doctor_id", opts.doctorId);
    }
    const res = await fetch(`/api/patients/search?${params}`, {
      credentials: "include",
      headers: authPortalHeaders(opts.portal),
      signal: opts.signal,
    });
    const data = (await res.json()) as {
      patients?: PatientSearchResult[];
      error?: string;
    };

    if (!res.ok) {
      return {
        patients: [],
        error: data.error ?? "تعذر البحث عن المراجع",
      };
    }

    return { patients: data.patients ?? [] };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { patients: [] };
    }
    return { patients: [], error: "تعذر الاتصال بالسيرفر" };
  }
}
