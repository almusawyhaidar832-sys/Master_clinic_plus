import { NextRequest, NextResponse } from "next/server";
import { requireBotClinic } from "@/lib/integration/bot-route-helpers";

/** GET /api/bot/health — فحص صلاحية مفتاح API لعيادة معيّنة (N8N) */
export async function GET(req: NextRequest) {
  const auth = await requireBotClinic(req);
  if (!auth.ok) return auth.response;

  return NextResponse.json({ ok: true, clinic_id: auth.clinicId });
}
