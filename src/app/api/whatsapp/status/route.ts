import { NextRequest, NextResponse } from "next/server";
import { createApiSessionClient, getApiCallerProfile } from "@/lib/auth/api-session";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";
import { resolveEvolutionSession } from "@/lib/whatsapp/evolution-client";
import { resolveWhatsAppClinic } from "@/lib/whatsapp/resolve-clinic";
import { resolveWhatsAppInstanceName } from "@/lib/whatsapp/resolve-instance";
import { requireWhatsAppManageAccess } from "@/lib/whatsapp/require-api-access";

/** GET /api/whatsapp/status — حالة الاتصال + تحديث whatsapp_linked في العيادة */
export async function GET(req: NextRequest) {
  const access = await requireWhatsAppManageAccess(req);
  if (!access.ok) return access.response;

  const cfg = getWhatsAppConfig();
  if (!cfg.configured) {
    return NextResponse.json({
      linked: false,
      state: "unknown",
      configured: false,
      message:
        "أضف WHATSAPP_API_URL و WHATSAPP_API_KEY في Railway Variables أو .env.local",
    });
  }

  if (cfg.provider === "legacy") {
    try {
      const res = await fetch(`${cfg.baseUrl}/instance/qr`, {
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
      });
      const data = await res.json();
      const linked = data.status === "connected";
      await syncClinicLinked(linked, cfg.instanceName);
      return NextResponse.json({ linked, state: linked ? "open" : "close" });
    } catch {
      return NextResponse.json({ linked: false, state: "unknown" });
    }
  }

  const instanceName = await resolveWhatsAppInstanceName();
  const session = await resolveEvolutionSession(instanceName);
  await syncClinicLinked(session.linked, instanceName);

  return NextResponse.json({
    linked: session.linked,
    state: session.state,
    configured: true,
    instanceName,
    raw:
      process.env.NODE_ENV === "development"
        ? {
            connectionState: session.connectionStateData,
            instances: session.instanceListData,
          }
        : undefined,
  });
}

async function syncClinicLinked(linked: boolean, instanceName: string) {
  try {
    const profile = await getApiCallerProfile();
    if (!profile) return;

    const supabase = await createApiSessionClient();
    const resolved = await resolveWhatsAppClinic(supabase, profile.clinic_id);
    if (!resolved) return;

    const { clinicId } = resolved;

    await supabase
      .from("clinics")
      .update({
        whatsapp_linked: linked,
        whatsapp_session_id: instanceName,
      })
      .eq("id", clinicId);
  } catch (e) {
    console.error("[whatsapp/status] clinic_sync_failed", e);
  }
}
