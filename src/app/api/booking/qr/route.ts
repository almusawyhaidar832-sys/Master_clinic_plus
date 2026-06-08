import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile, isApiStaffRole } from "@/lib/auth/api-session";
import { fetchDeveloperActingClinic } from "@/lib/auth/developer-acting-clinic";
import { getAdminClient } from "@/lib/supabase/admin";
import { ensureClinicBookingCode } from "@/lib/booking/server";
import { buildBookingUrl } from "@/lib/booking/urls";
import { resolveBookingPublicOrigin } from "@/lib/booking/public-origin";

/**
 * GET /api/booking/qr
 * Returns booking URL + code for the authenticated clinic owner/staff.
 */
export async function GET(req: NextRequest) {
  try {
    const acting = await fetchDeveloperActingClinic();
    let clinicId = acting?.clinicId ?? null;

    if (!clinicId) {
      const profile = await getApiCallerProfile(req);
      if (!profile?.clinic_id || !isApiStaffRole(profile.role as string)) {
        return NextResponse.json(
          { error: "يجب تسجيل الدخول كمحاسب أو مدير عيادة لعرض الباركود" },
          { status: 401 }
        );
      }
      clinicId = profile.clinic_id as string;
    }

    const bookingCode = await ensureClinicBookingCode(clinicId);
    const { origin, unreachableOnMobile } = resolveBookingPublicOrigin({
      clientOrigin: req.nextUrl.searchParams.get("origin"),
      requestOrigin: req.nextUrl.origin,
      forwardedHost: req.headers.get("x-forwarded-host"),
      forwardedProto: req.headers.get("x-forwarded-proto"),
    });

    const bookingUrl = buildBookingUrl(bookingCode, origin);

    const admin = getAdminClient();
    const { data: clinic } = await admin
      .from("clinics")
      .select("name, name_ar")
      .eq("id", clinicId)
      .maybeSingle();

    return NextResponse.json({
      clinicId,
      bookingCode,
      bookingUrl,
      clinicName: clinic?.name_ar || clinic?.name || "العيادة",
      unreachableOnMobile,
    });
  } catch (err) {
    console.error("[api/booking/qr]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "تعذر تحميل باركود الحجز" },
      { status: 500 }
    );
  }
}
