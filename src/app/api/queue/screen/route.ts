import { NextRequest, NextResponse } from "next/server";
import { fetchClinicQueue } from "@/lib/queue/server";
import { resolveActiveClinicByRef } from "@/lib/queue/clinic-ref";

/**
 * GET /api/queue/screen?clinic=<uuid|booking_code>
 * Public waiting-room display — no login (clinic ref in URL acts as key).
 */
export async function GET(req: NextRequest) {
  try {
    const clinicRef = req.nextUrl.searchParams.get("clinic")?.trim();
    if (!clinicRef) {
      return NextResponse.json({ error: "معرّف العيادة مطلوب" }, { status: 400 });
    }

    const clinic = await resolveActiveClinicByRef(clinicRef);
    if (!clinic) {
      return NextResponse.json({ error: "العيادة غير موجودة" }, { status: 404 });
    }

    const queue = await fetchClinicQueue(clinic.id, {
      includeDone: false,
      excludeCancellationPending: true,
    });
    const hiddenOnScreen = new Set([
      "done",
      "cancelled",
      "ready_for_billing",
      "ready_for_payment",
    ]);
    const active = queue.filter((e) => !hiddenOnScreen.has(e.status));

    return NextResponse.json({
      clinicId: clinic.id,
      clinicRef: clinic.bookingCode ?? clinic.id,
      clinicName: clinic.name,
      queue: active,
    });
  } catch (err) {
    console.error("[api/queue/screen]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "تعذر تحميل الشاشة" },
      { status: 500 }
    );
  }
}
