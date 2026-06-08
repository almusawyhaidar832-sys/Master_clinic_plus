import type { SupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { DEVELOPER_CLINIC_HEADER } from "@/lib/auth/developer-gate";
import { getActiveClinicIdServer } from "@/lib/clinic-context.server";
import {
  fetchClinicProfile,
  getClinicDisplayName,
} from "@/lib/services/clinic-profile";
import type { ClinicProfile } from "@/types/clinic-profile";
import { getAdminClient } from "@/lib/supabase/admin";

export type ResolvedWhatsAppClinic = {
  clinicId: string;
  clinic: ClinicProfile | null;
  clinicName: string;
};

const NO_CLINIC_HINT =
  "حسابك غير مربوط بعيادة — تواصل مع المدير العام لربط clinic_id في ملفك الشخصي.";

export function whatsappNoClinicError(): { error: string; hint: string } {
  return { error: "لا توجد عيادة", hint: NO_CLINIC_HINT };
}

/**
 * يحدّد العيادة لمسارات WhatsApp API — يستخدم جلسة المستخدم الصحيحة (أي بوابة)
 */
export async function resolveWhatsAppClinic(
  supabase: SupabaseClient,
  profileClinicId: string | null | undefined
): Promise<ResolvedWhatsAppClinic | null> {
  let clinicId = profileClinicId?.trim() || null;

  if (!clinicId) {
    try {
      const headerStore = await headers();
      clinicId = headerStore.get(DEVELOPER_CLINIC_HEADER)?.trim() || null;
    } catch {
      /* outside request */
    }
  }

  if (!clinicId) {
    const active = await getActiveClinicIdServer(supabase);
    clinicId = active?.clinicId ?? null;
  }

  if (!clinicId) return null;

  let clinic = await fetchClinicProfile(supabase, clinicId);

  if (!clinic) {
    try {
      clinic = await fetchClinicProfile(getAdminClient(), clinicId);
    } catch {
      /* service role optional in dev */
    }
  }

  return {
    clinicId,
    clinic,
    clinicName: getClinicDisplayName(clinic),
  };
}
