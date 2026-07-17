import { NextRequest, NextResponse } from "next/server";
import { requireBotClinic } from "@/lib/integration/bot-route-helpers";

/** GET /api/bot/clinic — بيانات العيادة والأطباء المرتبطين بمفتاح API (N8N) */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireBotClinic(req);
    if (!auth.ok) return auth.response;
    const { clinicId, admin } = auth;

    const { data: clinic, error } = await admin
      .from("clinics")
      .select("id, name, name_ar, address, phone, logo_url, booking_code, is_active")
      .eq("id", clinicId)
      .maybeSingle();

    if (error || !clinic || !clinic.is_active) {
      return NextResponse.json({ error: "العيادة غير متاحة" }, { status: 404 });
    }

    const { data: doctors } = await admin
      .from("doctors")
      .select("id, full_name_ar, specialty_ar")
      .eq("clinic_id", clinicId)
      .eq("is_active", true)
      .order("full_name_ar");

    return NextResponse.json({
      clinic_id: clinic.id,
      clinic_name: (clinic.name_ar as string) || (clinic.name as string) || "عيادة",
      booking_code: clinic.booking_code,
      address: clinic.address,
      phone: clinic.phone,
      logo_url: clinic.logo_url,
      doctors: (doctors ?? []).map((d) => ({
        id: d.id,
        name: d.full_name_ar,
        specialty: d.specialty_ar,
      })),
    });
  } catch (err) {
    console.error("[api/bot/clinic]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "تعذر تحميل بيانات العيادة" },
      { status: 500 }
    );
  }
}
