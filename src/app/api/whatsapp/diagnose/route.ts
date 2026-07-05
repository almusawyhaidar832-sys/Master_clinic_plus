import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { validatePatientPhone, phoneToLocalDisplay } from "@/lib/phone";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";
import {
  checkEvolutionWhatsAppNumber,
  formatEvolutionApiNumber,
  resolveEvolutionSession,
  summarizeEvolutionInstances,
} from "@/lib/whatsapp/evolution-client";
import { resolveWhatsAppClinic } from "@/lib/whatsapp/resolve-clinic";
import { resolveWhatsAppInstanceForClinic } from "@/lib/whatsapp/resolve-instance";
import { requireWhatsAppManageAccess } from "@/lib/whatsapp/require-api-access";
import { createApiSessionClient } from "@/lib/auth/api-session";

const RAILWAY_FIX_STEPS = [
  "Docker Image: evoapicloud/evolution-api:v2.3.7 (لا تستخدم 2.4.0 — يطلب ترخيص)",
  "WPP_LID_MODE=false",
  "CONFIG_SESSION_PHONE_VERSION=2.3000.1039700148 (من wppconnect.io/whatsapp-versions)",
  "SERVER_URL = نفس رابط Evolution العام على Railway",
  "instance واحد فقط للعيادة — احذف الباقي من Manager",
  "Logout → QR جديد من /dashboard/whatsapp",
];

/** GET /api/whatsapp/diagnose?phone=078... — تشخيص Evolution بدون إرسال */
export async function GET(request: NextRequest) {
  const access = await requireWhatsAppManageAccess(request);
  if (!access.ok) return access.response;

  const profile =
    access.profile ?? (await getApiCallerProfile(request));
  if (!profile) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }

  const cfg = getWhatsAppConfig();
  const phoneParam = request.nextUrl.searchParams.get("phone")?.trim() ?? "";

  const supabase = await createApiSessionClient(request);
  const resolved = await resolveWhatsAppClinic(supabase, profile.clinic_id);
  if (!resolved) {
    return NextResponse.json({ error: "تعذر تحديد العيادة" }, { status: 400 });
  }

  const instanceName = await resolveWhatsAppInstanceForClinic(resolved.clinicId);
  const session = await resolveEvolutionSession(instanceName, { skipCache: true });
  const instances = await summarizeEvolutionInstances();

  const connectedCount = instances.filter((i) => i.connected).length;
  const extraInstances = instances.filter(
    (i) => i.name && i.name !== instanceName && i.connected
  );

  const issues: string[] = [];
  if (!cfg.configured) {
    issues.push("WHATSAPP_API_URL أو WHATSAPP_API_KEY غير مضبوط على Vercel");
  }
  if (!session.linked) {
    issues.push("جلسة واتساب غير متصلة (connectionState ليس open)");
  }
  if (connectedCount > 1) {
    issues.push(
      `عدة instances متصلة (${connectedCount}) — يجب instance واحد فقط للعيادة`
    );
  }
  if (extraInstances.length > 0) {
    issues.push(
      `instances زائدة متصلة: ${extraInstances.map((i) => i.name).join(", ")}`
    );
  }

  let numberCheck: Awaited<ReturnType<typeof checkEvolutionWhatsAppNumber>> | null =
    null;
  let phoneValidated: string | null = null;

  if (phoneParam) {
    const validated = validatePatientPhone(phoneParam);
    if (validated.ok) {
      phoneValidated = validated.normalized;
      numberCheck = await checkEvolutionWhatsAppNumber(validated.normalized, {
        clinicId: resolved.clinicId,
        instanceName,
      });
      if (!numberCheck.skipped && !numberCheck.exists) {
        issues.push("الرقم غير مسجّل على واتساب");
      }
      if (numberCheck.jid?.includes("@lid")) {
        issues.push(
          "الرقم يُرجَع كـ @lid — حدّث Evolution (WPP_LID_MODE=false)"
        );
      }
    }
  }

  return NextResponse.json({
    ok: issues.length === 0,
    configured: cfg.configured,
    provider: cfg.provider,
    instanceName,
    clinicId: resolved.clinicId,
    session: {
      linked: session.linked,
      state: session.state,
      linkedPhoneDisplay: session.linkedPhone
        ? phoneToLocalDisplay(session.linkedPhone)
        : null,
      profileName: session.profileName,
    },
    instances: instances.map((i) => ({
      name: i.name,
      connected: i.connected,
      phoneDisplay: i.phone ? phoneToLocalDisplay(i.phone) : null,
      profileName: i.profileName,
      isClinicInstance: i.name === instanceName,
    })),
    phoneCheck: phoneValidated
      ? {
          normalized: phoneValidated,
          evolutionNumber: formatEvolutionApiNumber(phoneValidated),
          exists: numberCheck?.exists ?? null,
          jid: numberCheck?.jid ?? null,
          skipped: numberCheck?.skipped ?? false,
        }
      : null,
    issues,
    fixSteps: issues.length > 0 ? RAILWAY_FIX_STEPS : [],
    evolutionManagerUrl: cfg.baseUrl ? `${cfg.baseUrl}/manager` : null,
  });
}
