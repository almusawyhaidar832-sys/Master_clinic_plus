import type { SupabaseClient } from "@supabase/supabase-js";
import type { Assistant, Doctor, Profile } from "@/types";
import { fetchDeveloperActingClinic } from "@/lib/auth/developer-acting-clinic";
import type { ActiveClinicResult } from "@/lib/clinic-types";
import { getCurrentUser } from "@/lib/supabase/auth-helpers";
import {
  cacheAuthProfile,
  getCachedAuthProfile,
  isBrowserOffline,
} from "@/lib/offline-cache";

export type { ActiveClinicResult } from "@/lib/clinic-types";

export async function getAuthProfile(
  supabase: SupabaseClient
): Promise<Profile | null> {
  const user = await getCurrentUser(supabase);
  if (!user) return null;

  if (isBrowserOffline()) {
    return getCachedAuthProfile(user.id);
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) {
    return getCachedAuthProfile(user.id);
  }

  const profile = data as Profile;
  cacheAuthProfile(profile);
  return profile;
}

export async function getDoctorForCurrentUser(
  supabase: SupabaseClient
): Promise<Doctor | null> {
  const user = await getCurrentUser(supabase);
  if (!user) return null;

  const profile = await getAuthProfile(supabase);

  let query = supabase
    .from("doctors")
    .select("*")
    .eq("profile_id", user.id)
    .eq("is_active", true);

  if (profile?.clinic_id) {
    query = query.eq("clinic_id", profile.clinic_id);
  }

  const { data } = await query.maybeSingle();

  return data as Doctor | null;
}

export async function getAssistantForCurrentUser(
  supabase: SupabaseClient
): Promise<Assistant | null> {
  const user = await getCurrentUser(supabase);
  if (!user) return null;

  const profile = await getAuthProfile(supabase);
  if (profile?.role !== "assistant") return null;

  let query = supabase
    .from("assistants")
    .select("*")
    .eq("profile_id", user.id)
    .eq("is_active", true);

  if (profile.clinic_id) {
    query = query.eq("clinic_id", profile.clinic_id);
  }

  const { data } = await query.maybeSingle();
  return data as Assistant | null;
}

/** Returns profile.clinic_id only (no fallback) */
export async function getClinicIdFromProfile(
  supabase: SupabaseClient
): Promise<string | null> {
  const profile = await getAuthProfile(supabase);
  return profile?.clinic_id ?? null;
}

/**
 * Central clinic resolver — multi-tenant safe.
 * Priority:
 *   1. Developer acting clinic (impersonation)
 *   2. profiles.clinic_id only — no fallback to another clinic
 *
 * Returns null when the user has no clinic_id (fail closed).
 */
export async function getActiveClinicId(
  supabase: SupabaseClient
): Promise<ActiveClinicResult | null> {
  const acting = await fetchDeveloperActingClinic();
  if (acting) return acting;

  const profile = await getAuthProfile(supabase);
  if (!profile?.clinic_id) return null;

  const { data: clinic } = await supabase
    .from("clinics")
    .select("name_ar, name, is_active")
    .eq("id", profile.clinic_id)
    .maybeSingle();

  if (!clinic || (clinic as { is_active?: boolean }).is_active === false) {
    return null;
  }

  return {
    clinicId: profile.clinic_id,
    clinicName:
      (clinic as { name_ar?: string; name?: string }).name_ar ||
      (clinic as { name_ar?: string; name?: string }).name ||
      "",
    source: "profile",
  };
}
