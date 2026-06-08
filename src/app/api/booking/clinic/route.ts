import { NextRequest, NextResponse } from "next/server";
import { resolveBookingClinic } from "@/lib/booking/server";

/** GET /api/booking/clinic?clinic=CODE — public clinic + doctors */
export async function GET(req: NextRequest) {
  try {
    const clinicRef = req.nextUrl.searchParams.get("clinic")?.trim();
    if (!clinicRef) {
      return NextResponse.json({ error: "رمز العيادة مطلوب" }, { status: 400 });
    }

    const clinic = await resolveBookingClinic(clinicRef);
    if (!clinic) {
      return NextResponse.json(
        { error: "العيادة غير موجودة أو الحجز غير مفعّل لها" },
        { status: 404 }
      );
    }

    return NextResponse.json({ clinic });
  } catch (err) {
    console.error("[api/booking/clinic]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "تعذر تحميل العيادة" },
      { status: 500 }
    );
  }
}
