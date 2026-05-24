import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClinicProfile, ClinicProfileUpdate } from "@/types/clinic-profile";
import { getAuthProfile, getClinicIdFromProfile } from "@/lib/clinic-context";

/** Arabic display name for reports, WhatsApp, headers */
export function getClinicDisplayName(
  profile: ClinicProfile | null | undefined
): string {
  if (!profile) return "العيادة";
  return profile.name_ar?.trim() || profile.name?.trim() || "العيادة";
}

export function formatDoctorDisplayName(name: string | null | undefined): string {
  if (!name?.trim()) return "—";
  const n = name.trim();
  if (n.startsWith("د.") || n.startsWith("دكتور") || n.startsWith("الدكتور")) {
    return n;
  }
  return `د. ${n}`;
}

export async function fetchClinicProfile(
  supabase: SupabaseClient,
  clinicId?: string | null
): Promise<ClinicProfile | null> {
  let id = clinicId;
  if (!id) {
    id = await getClinicIdFromProfile(supabase);
  }
  if (!id) {
    const authProfile = await getAuthProfile(supabase);
    if (authProfile?.role === "super_admin") {
      const { data } = await supabase
        .from("clinics")
        .select(
          "id, name, name_ar, phone, address, logo_url, whatsapp_linked"
        )
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      return data as ClinicProfile | null;
    }
    return null;
  }

  const { data, error } = await supabase
    .from("clinics")
    .select("id, name, name_ar, phone, address, logo_url, whatsapp_linked")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return data as ClinicProfile;
}

export async function updateClinicProfile(
  supabase: SupabaseClient,
  updates: ClinicProfileUpdate
): Promise<{ ok: boolean; error?: string }> {
  const clinicId = await getClinicIdFromProfile(supabase);
  if (!clinicId) {
    return { ok: false, error: "لا يوجد عيادة مربوطة بالحساب" };
  }

  const { error } = await supabase
    .from("clinics")
    .update(updates)
    .eq("id", clinicId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
