import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClinicIntegrationRow } from "@/lib/integration/types";

const INTEGRATION_COLUMNS =
  "id, clinic_id, provider, bot_api_key_hash, bot_api_key_prefix, webhook_url, webhook_secret, whatsapp_numbers, is_active";

/**
 * إعدادات ربط N8N لعيادة محددة — null إذا لم تُفعَّل العيادة هذا الربط بعد
 * (وهو الحال الافتراضي لكل عيادة اليوم — لا يغيّر أي سلوك حالي).
 */
export async function getClinicIntegration(
  admin: SupabaseClient,
  clinicId: string
): Promise<ClinicIntegrationRow | null> {
  if (!clinicId?.trim()) return null;

  const { data, error } = await admin
    .from("clinic_integrations")
    .select(INTEGRATION_COLUMNS)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as ClinicIntegrationRow;
}

/** هل هذه العيادة تُرسل واتساب عبر N8N بدلاً من Evolution؟ */
export function isN8nBotProvider(
  row: ClinicIntegrationRow | null | undefined
): boolean {
  return Boolean(row && row.is_active && row.provider === "n8n_bot" && row.webhook_url?.trim());
}
