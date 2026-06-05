import type { SupabaseClient } from "@supabase/supabase-js";
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

export async function searchPatientsByQuery(
  supabase: SupabaseClient,
  query: string,
  opts: { limit?: number; minLength?: number } = {}
): Promise<{ patients: PatientSearchResult[]; error?: string }> {
  const q = query.trim();
  const minLength = opts.minLength ?? 2;
  const limit = opts.limit ?? 30;

  if (q.length < minLength) {
    return { patients: [] };
  }

  await supabase.rpc("link_profile_to_first_clinic");
  const activeClinic = await getActiveClinicId(supabase);

  let request = supabase
    .from("patients")
    .select(PATIENT_SEARCH_COLUMNS)
    .ilike("full_name_ar", `%${q}%`)
    .order("full_name_ar")
    .limit(limit);

  if (activeClinic?.clinicId) {
    request = request.eq("clinic_id", activeClinic.clinicId);
  }

  const { data, error } = await request;

  if (error) {
    const fallback = await supabase
      .from("patients")
      .select("id, clinic_id, full_name_ar, phone, notes")
      .ilike("full_name_ar", `%${q}%`)
      .order("full_name_ar")
      .limit(limit);

    if (fallback.error) {
      return { patients: [], error: fallback.error.message };
    }
    return { patients: (fallback.data as PatientSearchResult[]) ?? [] };
  }

  let patients = (data as PatientSearchResult[]) ?? [];

  if (patients.length === 0 && /^[\d+\s-]{4,}$/.test(q)) {
    const digits = q.replace(/\D/g, "");
    if (digits.length >= 4) {
      const phoneReq = supabase
        .from("patients")
        .select(PATIENT_SEARCH_COLUMNS)
        .or(`phone.ilike.%${digits}%,phone_number.ilike.%${digits}%`)
        .limit(limit);
      const filtered = activeClinic?.clinicId
        ? phoneReq.eq("clinic_id", activeClinic.clinicId)
        : phoneReq;
      const { data: byPhone } = await filtered;
      patients = (byPhone as PatientSearchResult[]) ?? [];
    }
  }

  return { patients };
}
