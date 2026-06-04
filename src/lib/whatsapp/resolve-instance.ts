import type { SupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { DEVELOPER_CLINIC_HEADER } from "@/lib/auth/developer-gate";
import { getActiveClinicIdServer } from "@/lib/clinic-context.server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";

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

  if (!clinicId) return cfg.instanceName;

  try {
    const admin = getAdminClient();
    const { data } = await admin
      .from("clinics")
      .select("whatsapp_session_id")
      .eq("id", clinicId)
      .maybeSingle();
    const instance = (data as { whatsapp_session_id?: string | null } | null)
      ?.whatsapp_session_id;
    if (instance?.trim()) return instance.trim();
  } catch {
    /* fallback env */
  }

  return cfg.instanceName;
}
