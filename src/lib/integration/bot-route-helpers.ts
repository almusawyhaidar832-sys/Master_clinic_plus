import "server-only";

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveBotClinic } from "@/lib/integration/bot-auth";
import { getAdminClient } from "@/lib/supabase/admin";

export type BotAuthResult =
  | { ok: true; clinicId: string; admin: SupabaseClient }
  | { ok: false; response: NextResponse };

/** يتحقق من X-Bot-Api-Key ويرجّع clinic_id — أو رد 401 جاهز للإرجاع مباشرة */
export async function requireBotClinic(req: NextRequest): Promise<BotAuthResult> {
  const admin = getAdminClient();
  const resolved = await resolveBotClinic(req, admin);
  if (!resolved) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "مفتاح API غير صالح أو العيادة معطّلة" },
        { status: 401 }
      ),
    };
  }
  return { ok: true, clinicId: resolved.clinicId, admin };
}
