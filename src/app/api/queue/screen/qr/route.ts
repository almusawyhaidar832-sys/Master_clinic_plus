import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile, isApiStaffRole } from "@/lib/auth/api-session";
import { fetchDeveloperActingClinic } from "@/lib/auth/developer-acting-clinic";
import { getAdminClient } from "@/lib/supabase/admin";
import { ensureClinicBookingCode } from "@/lib/booking/server";
import { buildQueueScreenUrl } from "@/lib/queue/clinic-ref";
import { detectDevLanOrigin, portFromOrigin } from "@/lib/booking/lan-origin";
import { resolveBookingPublicOrigin } from "@/lib/booking/public-origin";

/**
 * GET /api/queue/screen/qr
 * باركود شاشة انتظار المرضى للتلفاز — رابط قصير بدل UUID الطويل.
 */
export async function GET(req: NextRequest) {
  try {
    const acting = await fetchDeveloperActingClinic();
    let clinicId = acting?.clinicId ?? null;

    if (!clinicId) {
      const profile = await getApiCallerProfile(req);
      if (!profile?.clinic_id || !isApiStaffRole(profile.role as string)) {
        return NextResponse.json(
          { error: "يجب تسجيل الدخول كمحاسب أو مدير عيادة" },
          { status: 401 }
        );
      }
      clinicId = profile.clinic_id as string;
    }

    const bookingCode = await ensureClinicBookingCode(clinicId);
    let { origin, unreachableOnMobile } = resolveBookingPublicOrigin({
      clientOrigin: req.nextUrl.searchParams.get("origin"),
      requestOrigin: req.nextUrl.origin,
      forwardedHost: req.headers.get("x-forwarded-host"),
      forwardedProto: req.headers.get("x-forwarded-proto"),
    });

    if (unreachableOnMobile) {
      const port = portFromOrigin(origin);
      const lan = detectDevLanOrigin(port);
      if (lan) {
        origin = lan;
        unreachableOnMobile = false;
      }
    }

    const screenUrl = buildQueueScreenUrl(bookingCode, origin);

    const admin = getAdminClient();
    const { data: clinic } = await admin
      .from("clinics")
      .select("name, name_ar")
      .eq("id", clinicId)
      .maybeSingle();

    return NextResponse.json({
      clinicId,
      clinicCode: bookingCode,
      screenUrl,
      clinicName: clinic?.name_ar || clinic?.name || "العيادة",
      unreachableOnMobile,
    });
  } catch (err) {
    console.error("[api/queue/screen/qr]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "تعذر تحميل باركود الشاشة" },
      { status: 500 }
    );
  }
}
