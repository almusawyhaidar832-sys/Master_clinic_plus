import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClinicProfile, ClinicProfileUpdate } from "@/types/clinic-profile";
import { getActiveClinicId } from "@/lib/clinic-context";
import {
  cacheClinicProfile,
  getCachedClinicProfile,
  isBrowserOffline,
} from "@/lib/offline-cache";

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

/** Core clinic columns — always safe to query */
const CLINIC_CORE_COLS =
  "id, name, name_ar, phone, address, logo_url, whatsapp_linked";

/** Optional columns added in later migrations */
const CLINIC_OPT_COLS = "review_fee_enabled, review_fee_amount";

export async function fetchClinicProfile(
  supabase: SupabaseClient,
  clinicId?: string | null
): Promise<ClinicProfile | null> {
  let id = clinicId;
  if (!id) {
    const active = await getActiveClinicId(supabase);
    id = active?.clinicId ?? null;
  }
  if (!id) return null;

  if (isBrowserOffline()) {
    return getCachedClinicProfile(id);
  }

  // Try full query (including optional columns)
  const { data, error } = await supabase
    .from("clinics")
    .select(`${CLINIC_CORE_COLS}, ${CLINIC_OPT_COLS}`)
    .eq("id", id)
    .maybeSingle();

  if (!error && data) {
    const profile = data as ClinicProfile;
    cacheClinicProfile(profile);
    return profile;
  }

  // Fallback: fetch only core columns if schema cache doesn't know optional cols yet
  const { data: coreData, error: coreError } = await supabase
    .from("clinics")
    .select(CLINIC_CORE_COLS)
    .eq("id", id)
    .maybeSingle();

  if (coreData) {
    const profile = coreData as ClinicProfile;
    cacheClinicProfile(profile);
    return profile;
  }

  if (coreError || error) {
    return getCachedClinicProfile(id);
  }

  return null;
}

export async function updateClinicProfile(
  supabase: SupabaseClient,
  updates: ClinicProfileUpdate
): Promise<{ ok: boolean; error?: string }> {
  const active = await getActiveClinicId(supabase);
  if (!active) {
    return { ok: false, error: "لا توجد عيادة في قاعدة البيانات. أنشئ عيادة أولاً." };
  }

  // Always send core fields
  const corePayload: Record<string, unknown> = {};
  if (updates.name !== undefined)    corePayload.name     = updates.name;
  if (updates.name_ar !== undefined) corePayload.name_ar  = updates.name_ar;
  if (updates.phone !== undefined)   corePayload.phone    = updates.phone;
  if (updates.address !== undefined) corePayload.address  = updates.address;
  if (updates.logo_url !== undefined) corePayload.logo_url = updates.logo_url;

  // Try to update core columns first
  const { error: coreErr } = await supabase
    .from("clinics")
    .update(corePayload)
    .eq("id", active.clinicId);

  if (coreErr) return { ok: false, error: coreErr.message };

  // Optionally update review fee columns (gracefully skip if they don't exist yet)
  if (
    updates.review_fee_enabled !== undefined ||
    updates.review_fee_amount !== undefined
  ) {
    const feePayload: Record<string, unknown> = {};
    if (updates.review_fee_enabled !== undefined)
      feePayload.review_fee_enabled = updates.review_fee_enabled;
    if (updates.review_fee_amount !== undefined)
      feePayload.review_fee_amount = updates.review_fee_amount;

    const { error: feeErr } = await supabase
      .from("clinics")
      .update(feePayload)
      .eq("id", active.clinicId);

    if (feeErr) {
      // Non-fatal: columns might not exist yet — return partial success
      return {
        ok: true,
        error: `تم الحفظ ولكن تعذر تحديث إعدادات الكشفية: ${feeErr.message}. شغّل reload-schema-cache.sql في Supabase.`,
      };
    }
  }

  return { ok: true };
}
