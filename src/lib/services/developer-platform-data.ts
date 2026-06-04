import type { SupabaseClient } from "@supabase/supabase-js";

const CLINIC_SELECT_FULL =
  "id, name, name_ar, phone, address, created_at, whatsapp_linked, whatsapp_session_id, is_active";
const CLINIC_SELECT_BASE =
  "id, name, name_ar, phone, address, created_at, whatsapp_linked, whatsapp_session_id";

export type PlatformClinicRow = {
  id: string;
  name: string;
  name_ar: string | null;
  phone: string | null;
  address: string | null;
  created_at: string;
  whatsapp_linked: boolean | null;
  whatsapp_session_id: string | null;
  is_active?: boolean | null;
  patient_count: number;
};

export async function fetchPlatformClinics(
  admin: SupabaseClient
): Promise<{ clinics: PlatformClinicRow[]; error?: string }> {
  let { data, error } = await admin
    .from("clinics")
    .select(CLINIC_SELECT_FULL)
    .order("created_at", { ascending: false });

  if (error?.message?.includes("is_active")) {
    const fallback = await admin
      .from("clinics")
      .select(CLINIC_SELECT_BASE)
      .order("created_at", { ascending: false });
    data = fallback.data?.map((c) => ({ ...c, is_active: true })) ?? null;
    error = fallback.error;
  }

  if (error) {
    return { clinics: [], error: error.message };
  }

  const clinics = data ?? [];
  const withCounts = await Promise.all(
    clinics.map(async (c) => {
      const { count } = await admin
        .from("patients")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", c.id);
      return {
        ...c,
        is_active: (c as { is_active?: boolean }).is_active ?? true,
        patient_count: count ?? 0,
      } as PlatformClinicRow;
    })
  );

  return { clinics: withCounts };
}

export async function fetchPlatformStats(admin: SupabaseClient): Promise<{
  totalClinics: number;
  activeClinics: number;
  totalPatients: number;
  whatsappConnected: number;
  error?: string;
}> {
  const [totalRes, patientsRes, whatsappRes] = await Promise.all([
    admin.from("clinics").select("id", { count: "exact", head: true }),
    admin.from("patients").select("id", { count: "exact", head: true }),
    admin
      .from("clinics")
      .select("id", { count: "exact", head: true })
      .eq("whatsapp_linked", true),
  ]);

  let activeClinics = totalRes.count ?? 0;
  const activeRes = await admin
    .from("clinics")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);

  if (activeRes.error?.message?.includes("is_active")) {
    activeClinics = totalRes.count ?? 0;
  } else if (!activeRes.error) {
    activeClinics = activeRes.count ?? 0;
  }

  const err =
    totalRes.error?.message ||
    patientsRes.error?.message ||
    whatsappRes.error?.message;

  return {
    totalClinics: totalRes.count ?? 0,
    activeClinics,
    totalPatients: patientsRes.count ?? 0,
    whatsappConnected: whatsappRes.count ?? 0,
    ...(err ? { error: err } : {}),
  };
}
