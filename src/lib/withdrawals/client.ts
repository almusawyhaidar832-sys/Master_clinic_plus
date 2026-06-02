import type { SupabaseClient } from "@supabase/supabase-js";
import type { DoctorWithdrawal } from "@/types";

/** Load withdrawals without PostgREST join (FK may be missing in schema cache) */
export async function fetchWithdrawalsWithDoctors(
  supabase: SupabaseClient,
  options?: { status?: "pending" | "all"; clinicId?: string | null }
): Promise<{ items: DoctorWithdrawal[]; error: string | null }> {
  let query = supabase
    .from("doctor_withdrawals")
    .select("*")
    .order("requested_at", { ascending: false });

  if (options?.status === "pending") {
    query = query.eq("status", "pending");
  }

  if (options?.clinicId) {
    query = query.eq("clinic_id", options.clinicId);
  }

  let doctorsQuery = supabase
    .from("doctors")
    .select("id, full_name_ar")
    .eq("is_active", true);

  if (options?.clinicId) {
    doctorsQuery = doctorsQuery.eq("clinic_id", options.clinicId);
  }

  const [withdrawalsRes, doctorsRes] = await Promise.all([
    query,
    doctorsQuery,
  ]);

  if (withdrawalsRes.error) {
    return { items: [], error: withdrawalsRes.error.message };
  }

  const doctorMap = new Map(
    (doctorsRes.data ?? []).map((d) => [d.id, d.full_name_ar as string])
  );

  const items = (withdrawalsRes.data ?? []).map((w) => ({
    ...(w as DoctorWithdrawal),
    doctor: {
      full_name_ar: doctorMap.get((w as { doctor_id: string }).doctor_id) ?? "طبيب",
    },
  }));

  return { items, error: null };
}
