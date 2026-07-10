import type { SupabaseClient } from "@supabase/supabase-js";
import type { Assistant, Doctor, Profile } from "@/types";
import { fetchDeveloperActingClinic } from "@/lib/auth/developer-acting-clinic";
import type { ActiveClinicResult } from "@/lib/clinic-types";
import { getCurrentUser } from "@/lib/supabase/auth-helpers";
import {
  cacheAuthProfile,
  getCachedAuthProfile,
  getCachedClinicProfile,
  isBrowserOffline,
} from "@/lib/offline-cache";
import { getCachedOfflineReference } from "@/lib/offline/reference-cache";

export type { ActiveClinicResult } from "@/lib/clinic-types";

async function fetchAuthProfileUncached(
  supabase: SupabaseClient
): Promise<Profile | null> {
  const user = await getCurrentUser(supabase);
  if (!user) return null;

  if (isBrowserOffline()) {
    return getCachedAuthProfile(user.id);
  }

  try {
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
  } catch {
    return getCachedAuthProfile(user.id);
  }
}

// Doctor/admin/accountant shells commonly call getAuthProfile from several
// independent components on the same navigation (shell, sync bridge, page).
// Coalesce those into a single request for a very short window — same result,
// fewer round-trips. After the window elapses, a fresh fetch happens as before.
const AUTH_PROFILE_DEDUPE_MS = 2_000;
const authProfileCache = new WeakMap<
  SupabaseClient,
  { promise: Promise<Profile | null>; at: number }
>();

export async function getAuthProfile(
  supabase: SupabaseClient
): Promise<Profile | null> {
  const now = Date.now();
  const cached = authProfileCache.get(supabase);
  if (cached && now - cached.at < AUTH_PROFILE_DEDUPE_MS) {
    return cached.promise;
  }

  const promise = fetchAuthProfileUncached(supabase);
  authProfileCache.set(supabase, { promise, at: now });
  return promise;
}

async function fetchDoctorForCurrentUserUncached(
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

// Doctor shell, queue realtime bridge, and individual pages all resolve the
// current doctor independently on the same navigation. Coalesce into a
// single request for a very short window — same result, fewer round-trips.
const DOCTOR_DEDUPE_MS = 2_000;
const doctorForCurrentUserCache = new WeakMap<
  SupabaseClient,
  { promise: Promise<Doctor | null>; at: number }
>();

export async function getDoctorForCurrentUser(
  supabase: SupabaseClient
): Promise<Doctor | null> {
  const now = Date.now();
  const cached = doctorForCurrentUserCache.get(supabase);
  if (cached && now - cached.at < DOCTOR_DEDUPE_MS) {
    return cached.promise;
  }

  const promise = fetchDoctorForCurrentUserUncached(supabase);
  doctorForCurrentUserCache.set(supabase, { promise, at: now });
  return promise;
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
  const clinicId =
    profile?.clinic_id ?? getCachedOfflineReference()?.clinicId ?? null;
  if (!clinicId) return null;

  if (isBrowserOffline()) {
    const cached = getCachedClinicProfile(clinicId);
    return {
      clinicId,
      clinicName: cached?.name_ar?.trim() || cached?.name?.trim() || "",
      source: "profile",
    };
  }

  const { data: clinic, error } = await supabase
    .from("clinics")
    .select("name_ar, name, is_active")
    .eq("id", clinicId)
    .maybeSingle();

  if (error || !clinic) {
    const cached = getCachedClinicProfile(clinicId);
    return {
      clinicId,
      clinicName: cached?.name_ar?.trim() || cached?.name?.trim() || "",
      source: "profile",
    };
  }

  if ((clinic as { is_active?: boolean }).is_active === false) {
    return null;
  }

  return {
    clinicId,
    clinicName:
      (clinic as { name_ar?: string; name?: string }).name_ar ||
      (clinic as { name_ar?: string; name?: string }).name ||
      "",
    source: "profile",
  };
}
