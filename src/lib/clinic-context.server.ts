import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDeveloperSessionFromCookies } from "@/lib/auth/developer-gate.server";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  getActiveClinicId,
  type ActiveClinicResult,
} from "@/lib/clinic-context";

/**
 * نفس getActiveClinicId مع دعم جلسة المدير العام (كوكي httpOnly).
 * للمسارات Server/API فقط — لا تستوردها من مكوّنات "use client".
 */
export async function getActiveClinicIdServer(
  supabase: SupabaseClient
): Promise<ActiveClinicResult | null> {
  const devSession = await getDeveloperSessionFromCookies();
  if (devSession?.actingClinicId) {
    try {
      const admin = getAdminClient();
      const { data: clinic } = await admin
        .from("clinics")
        .select("id, name_ar, name, is_active")
        .eq("id", devSession.actingClinicId)
        .maybeSingle();
      if (clinic) {
        const c = clinic as {
          id: string;
          name_ar?: string;
          name?: string;
          is_active?: boolean;
        };
        if (c.is_active === false) return null;
        return {
          clinicId: c.id,
          clinicName: c.name_ar || c.name || "",
          source: "developer",
        };
      }
    } catch {
      /* service role optional */
    }
  }

  return getActiveClinicId(supabase);
}
