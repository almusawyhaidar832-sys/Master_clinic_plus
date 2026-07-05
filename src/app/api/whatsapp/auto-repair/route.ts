import { NextRequest, NextResponse } from "next/server";
import {
  createApiSessionClient,
  getApiCallerProfile,
} from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { autoRepairEvolutionWhatsApp } from "@/lib/whatsapp/evolution-client";
import { resolveWhatsAppClinic } from "@/lib/whatsapp/resolve-clinic";
import { resolveWhatsAppInstanceForClinic } from "@/lib/whatsapp/resolve-instance";
import { requireWhatsAppManageAccess } from "@/lib/whatsapp/require-api-access";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";

/**
 * POST /api/whatsapp/auto-repair
 * يحذف instances الزائدة، يعيد ضبط جلسة العيادة، ويعرض QR.
 * المطلوب من المستخدم: مسح QR مرة واحدة من جوال العيادة فقط.
 */
export async function POST(request: NextRequest) {
  const access = await requireWhatsAppManageAccess(request);
  if (!access.ok) return access.response;

  const profile =
    access.profile ?? (await getApiCallerProfile(request));
  if (!profile) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }

  const cfg = getWhatsAppConfig();
  if (!cfg.configured) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "واتساب غير مُعدّ على Vercel — تواصل مع مطوّر النظام لضبط WHATSAPP_API_URL",
      },
      { status: 400 }
    );
  }

  const supabase = await createApiSessionClient(request);
  const resolved = await resolveWhatsAppClinic(supabase, profile.clinic_id);
  if (!resolved) {
    return NextResponse.json({ error: "تعذر تحديد العيادة" }, { status: 400 });
  }

  const instanceName = await resolveWhatsAppInstanceForClinic(resolved.clinicId);

  const result = await autoRepairEvolutionWhatsApp(instanceName);

  try {
    const admin = getAdminClient();
    await admin
      .from("clinics")
      .update({
        whatsapp_session_id: instanceName,
        whatsapp_linked: result.qr.linked,
      })
      .eq("id", resolved.clinicId);
  } catch (e) {
    console.error("[whatsapp/auto-repair] clinic_sync_failed", e);
  }

  const qrSrc = result.qr.qrImageSrc;

  return NextResponse.json({
    ok: result.ok,
    instanceName,
    deletedInstances: result.deletedInstances,
    deleteFailures: result.deleteFailures,
    linked: result.qr.linked,
    state: result.qr.connectionState,
    qr: qrSrc,
    linkedPhone: result.qr.linkedPhone ?? null,
    profileName: result.qr.profileName ?? null,
    error: result.error ?? null,
    message: result.qr.linked
      ? "تم الإصلاح — واتساب متصل الآن"
      : qrSrc
        ? "تم الإصلاح — امسح QR من جوال العيادة (خطوة واحدة)"
        : result.error ?? "تعذر إكمال الإصلاح — حاول مرة أخرى",
  });
}
