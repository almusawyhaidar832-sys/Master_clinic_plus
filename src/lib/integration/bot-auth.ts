import "server-only";

import crypto from "crypto";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient } from "@/lib/supabase/admin";
import type { ClinicIntegrationRow } from "@/lib/integration/types";

export const BOT_API_KEY_HEADER = "x-bot-api-key";
/** بعض تدفقات N8N الجاهزة تستخدم هذا الاسم — نقبله كمرادف لتقليل التعديلات المطلوبة عندهم */
const BOT_API_KEY_HEADER_ALIAS = "x-api-key";
const KEY_PREFIX = "mcp_bot_";

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

/** رمز مختصر من UUID العيادة — للعرض داخل المفتاح فقط، لا يُستخدم للتحقق */
function shortClinicTag(clinicId: string): string {
  return clinicId.replace(/-/g, "").slice(0, 8);
}

/**
 * توليد مفتاح API جديد لعيادة — يُعرض للمستخدم مرة واحدة فقط.
 * نُخزّن في قاعدة البيانات hash فقط (bot_api_key_hash)، وليس المفتاح نفسه.
 */
export function generateBotApiKey(clinicId: string): {
  fullKey: string;
  keyHash: string;
  keyPrefix: string;
} {
  const random = crypto.randomBytes(24).toString("base64url");
  const fullKey = `${KEY_PREFIX}${shortClinicTag(clinicId)}_${random}`;
  return {
    fullKey,
    keyHash: sha256Hex(fullKey),
    keyPrefix: fullKey.slice(0, KEY_PREFIX.length + 9),
  };
}

export function hashBotApiKey(key: string): string {
  return sha256Hex(key.trim());
}

export interface ResolvedBotClinic {
  clinicId: string;
  integration: ClinicIntegrationRow;
}

/**
 * التحقق من X-Bot-Api-Key وإرجاع العيادة المرتبطة به.
 * null = مفتاح غائب / غير صالح / العيادة معطّلة — على المستدعي إرجاع 401.
 */
export async function resolveBotClinic(
  req: NextRequest,
  admin?: SupabaseClient
): Promise<ResolvedBotClinic | null> {
  const key =
    req.headers.get(BOT_API_KEY_HEADER)?.trim() ||
    req.headers.get(BOT_API_KEY_HEADER_ALIAS)?.trim();
  if (!key) return null;

  const client = admin ?? getAdminClient();
  const keyHash = hashBotApiKey(key);

  const { data, error } = await client
    .from("clinic_integrations")
    .select(
      "id, clinic_id, provider, bot_api_key_hash, bot_api_key_prefix, webhook_url, webhook_secret, whatsapp_numbers, is_active"
    )
    .eq("bot_api_key_hash", keyHash)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as unknown as ClinicIntegrationRow;
  if (row.provider === "disabled") return null;

  return { clinicId: row.clinic_id, integration: row };
}
