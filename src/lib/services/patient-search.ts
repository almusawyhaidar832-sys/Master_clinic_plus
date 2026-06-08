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
  opts: { limit?: number; minLength?: number; clinicId?: string } = {}
): Promise<{ patients: PatientSearchResult[]; error?: string }> {
  const q = query.trim();
  const minLength = opts.minLength ?? 2;
  const limit = opts.limit ?? 30;

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

  const { data, error } = await supabase
    .from("patients")
    .select(PATIENT_SEARCH_COLUMNS)
    .eq("clinic_id", activeClinic.clinicId)
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
        .eq("clinic_id", activeClinic.clinicId)
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
