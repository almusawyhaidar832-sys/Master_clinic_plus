import type { SupabaseClient } from "@supabase/supabase-js";
import type { Doctor, Profile } from "@/types";

export async function getAuthProfile(
  supabase: SupabaseClient
): Promise<Profile | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return data as Profile | null;
}

export async function getDoctorForCurrentUser(
  supabase: SupabaseClient
): Promise<Doctor | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("doctors")
    .select("*")
    .eq("profile_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  return data as Doctor | null;
}

export async function getClinicIdFromProfile(
  supabase: SupabaseClient
): Promise<string | null> {
  const profile = await getAuthProfile(supabase);
  return profile?.clinic_id ?? null;
}
