import { NextRequest, NextResponse } from "next/server";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";
import { fetchEvolutionQr } from "@/lib/whatsapp/evolution-client";
import { resolveWhatsAppInstanceName } from "@/lib/whatsapp/resolve-instance";
import { requireWhatsAppManageAccess } from "@/lib/whatsapp/require-api-access";

/**
 * GET /api/whatsapp/qr
 * يجلب QR من Evolution API ويعيد base64 جاهزاً لـ <img src="..." />
 * لا يُخزَّن QR في Supabase — يُعرض مباشرة من الجسر (يُحدَّث كل ~20 ثانية).
 */
export async function GET(req: NextRequest) {
  const access = await requireWhatsAppManageAccess(req);
  if (!access.ok) return access.response;

  const cfg = getWhatsAppConfig();

  if (!cfg.configured) {
    return NextResponse.json({
      linked: false,
      qr: null,
      state: "unknown",
      configured: false,
      message:
        "لم تُحمَّل WHATSAPP_API_URL أو WHATSAPP_API_KEY — أضفها في .env.local (محلياً) أو Variables في Railway (إنتاج) ثم أعد النشر.",
    });
  }

  if (cfg.provider === "legacy") {
    try {
      const res = await fetch(`${cfg.baseUrl}/instance/qr`, {
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
      });
      const data = await res.json();
      return NextResponse.json({
        linked: data.status === "connected",
        qr: data.qr || data.base64,
        state: data.status,
        provider: "legacy",
      });
    } catch (e) {
      console.error("[whatsapp/qr] legacy_bridge_error", e);
      return NextResponse.json({
        linked: false,
        qr: null,
        message: "تعذر الاتصال بالجسر",
      });
    }
  }

  try {
    const instanceName = await resolveWhatsAppInstanceName();
    const result = await fetchEvolutionQr();
    return NextResponse.json({
      linked: result.linked,
      qr: result.qrImageSrc,
      state: result.connectionState,
      instanceName,
      configured: true,
      error: result.error,
      provider: "evolution",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[whatsapp/qr] evolution_error", msg);
    return NextResponse.json({
      linked: false,
      qr: null,
      message: msg,
    });
  }
}
