import { NextResponse } from "next/server";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";
import { restartEvolutionInstance } from "@/lib/whatsapp/evolution-client";
import { resolveWhatsAppInstanceName } from "@/lib/whatsapp/resolve-instance";

/** POST /api/whatsapp/restart — QR جديد بعد logout (يحل Couldn't link device) */
export async function POST() {
  const cfg = getWhatsAppConfig();
  if (!cfg.configured) {
    return NextResponse.json(
      {
        ok: false,
        message: "لم تُضبط متغيرات الواتساب على سيرفر التطبيق",
      },
      { status: 400 }
    );
  }

  try {
    const instanceName = await resolveWhatsAppInstanceName();
    const result = await restartEvolutionInstance();
    return NextResponse.json({
      ok: true,
      linked: result.linked,
      qr: result.qrImageSrc,
      state: result.connectionState,
      error: result.error,
      instanceName,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[whatsapp/restart]", msg);
    return NextResponse.json({ ok: false, message: msg }, { status: 502 });
  }
}
