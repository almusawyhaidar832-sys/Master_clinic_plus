import type { SupabaseClient } from "@supabase/supabase-js";
import type { Doctor, Profile } from "@/types";
import { getCurrentUser } from "@/lib/supabase/auth-helpers";

export async function getAuthProfile(
  supabase: SupabaseClient
): Promise<Profile | null> {
  const user = await getCurrentUser(supabase);
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) return null;
  return data as Profile;
}

export async function getDoctorForCurrentUser(
  supabase: SupabaseClient
): Promise<Doctor | null> {
  const user = await getCurrentUser(supabase);
  if (!user) return null;

  const { data } = await supabase
    .from("doctors")
    .select("*")
    .eq("profile_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  return data as Doctor | null;
}

/** Returns profile.clinic_id only (no fallback) */
export async function getClinicIdFromProfile(
  supabase: SupabaseClient
): Promise<string | null> {
  const profile = await getAuthProfile(supabase);
  return profile?.clinic_id ?? null;
}

export interface ActiveClinicResult {
  clinicId: string;
  clinicName: string;
  /** "profile" = from user's profile; "fallback" = first clinic in DB */
  source: "profile" | "fallback";
}

/**
 * Central clinic resolver — always returns a valid clinic for the current session.
 * Priority:
 *   1. profiles.clinic_id  (user explicitly linked)
 *   2. First row in clinics table (auto-fallback for single-clinic setups)
 *
 * Returns null only when NO clinic exists in the database at all.
 */
export async function getActiveClinicId(
  supabase: SupabaseClient
): Promise<ActiveClinicResult | null> {
  // 1. Try profile clinic_id
  const profile = await getAuthProfile(supabase);
  if (profile?.clinic_id) {
    const { data: clinic } = await supabase
      .from("clinics")
      .select("name_ar, name")
      .eq("id", profile.clinic_id)
      .maybeSingle();

    return {
      clinicId: profile.clinic_id,
      clinicName:
        (clinic as { name_ar?: string; name?: string } | null)?.name_ar ||
        (clinic as { name_ar?: string; name?: string } | null)?.name ||
        "",
      source: "profile",
    };
  }

  // 2. Fallback: first clinic in the database
  const { data: firstClinic } = await supabase
    .from("clinics")
    .select("id, name_ar, name")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!firstClinic) return null;

  const c = firstClinic as { id: string; name_ar?: string; name?: string };
  return {
    clinicId: c.id,
    clinicName: c.name_ar || c.name || "",
    source: "fallback",
  };
}
