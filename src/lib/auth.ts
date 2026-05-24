import { createClient } from "@/lib/supabase/server";
import type { Profile, UserRole } from "@/types";

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
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

export async function requireRole(allowed: UserRole[]): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile || !allowed.includes(profile.role)) {
    throw new Error("غير مصرح");
  }
  return profile;
}

export async function getClinicId(): Promise<string | null> {
  const profile = await getCurrentProfile();
  return profile?.clinic_id ?? null;
}
