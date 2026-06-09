import type { SupabaseClient } from "@supabase/supabase-js";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import { getActiveClinicId } from "@/lib/clinic-context";
import type { Patient } from "@/types";

const PATIENT_SEARCH_COLUMNS =
  "id, clinic_id, full_name_ar, phone, phone_number, notes, created_at, updated_at";

export type PatientSearchResult = Pick<
  Patient,
  "id" | "clinic_id" | "full_name_ar" | "phone" | "notes"
> & {
  phone_number?: string | null;
  created_at?: string;
  updated_at?: string;
};

export const PATIENT_SEARCH_MIN_LENGTH = 2;
export const PATIENT_SEARCH_DEBOUNCE_MS = 300;

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
