import type { SupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { DEVELOPER_CLINIC_HEADER } from "@/lib/auth/developer-gate";
import { getActiveClinicIdServer } from "@/lib/clinic-context.server";
import { buildClinicInstanceName } from "@/lib/services/platform-clinic";
import { getAdminClient } from "@/lib/supabase/admin";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";

/** اسم instance Evolution لعيادة محددة (من DB أو mc_{slug}_{id}). */
export async function resolveWhatsAppInstanceForClinic(
  clinicId: string
): Promise<string> {
  const cfg = getWhatsAppConfig();
  const id = clinicId.trim();
  if (!id) return cfg.instanceName;

  try {
    const admin = getAdminClient();
    const { data } = await admin
      .from("clinics")
      .select("whatsapp_session_id, name, name_ar")
      .eq("id", id)
      .maybeSingle();
    const row = data as {
      whatsapp_session_id?: string | null;
      name?: string;
      name_ar?: string | null;
    } | null;
    if (row?.whatsapp_session_id?.trim()) {
      return row.whatsapp_session_id.trim();
    }
    return buildClinicInstanceName(id, row?.name_ar || row?.name);
  } catch {
    return buildClinicInstanceName(id, null);
  }
}

/** اسم instance Evolution للعيادة النشطة (أو الافتراضي من env). */
export async function resolveWhatsAppInstanceName(
  supabase?: SupabaseClient
): Promise<string> {
  const cfg = getWhatsAppConfig();
  let clinicId: string | null = null;

  try {
    const headerStore = await headers();
    clinicId = headerStore.get(DEVELOPER_CLINIC_HEADER);
  } catch {
    /* outside request */
  }

  if (!clinicId && supabase) {
    const active = await getActiveClinicIdServer(supabase);
    clinicId = active?.clinicId ?? null;
  }

  if (!clinicId) {
    const profile = await getApiCallerProfile();
    clinicId = profile?.clinic_id?.trim() ?? null;
  }

  if (!clinicId) return cfg.instanceName;

  return resolveWhatsAppInstanceForClinic(clinicId);
}
