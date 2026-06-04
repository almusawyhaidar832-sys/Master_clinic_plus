import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getClinicIdFromProfile } from "@/lib/clinic-context";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";
import { fetchEvolutionConnectionState } from "@/lib/whatsapp/evolution-client";

/** GET /api/whatsapp/status — حالة الاتصال + تحديث whatsapp_linked في العيادة */
export async function GET() {
  const cfg = getWhatsAppConfig();
  if (!cfg.configured) {
    return NextResponse.json({
      linked: false,
      state: "unknown",
      message: "لم يُضبط جسر الواتساب في البيئة",
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

  const { state, data } = await fetchEvolutionConnectionState();
  const linked = state === "open";
  await syncClinicLinked(linked, cfg.instanceName);

  return NextResponse.json({
    linked,
    state,
    instanceName: cfg.instanceName,
    raw: process.env.NODE_ENV === "development" ? data : undefined,
  });
}

async function syncClinicLinked(linked: boolean, instanceName: string) {
  try {
    const supabase = await createClient();
    const clinicId = await getClinicIdFromProfile(supabase);
    if (!clinicId) return;

    await supabase
      .from("clinics")
      .update({
        whatsapp_linked: linked,
        whatsapp_session_id: linked ? instanceName : null,
      })
      .eq("id", clinicId);
  } catch (e) {
    console.error("[whatsapp/status] clinic_sync_failed", e);
  }
}
