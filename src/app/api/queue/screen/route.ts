import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { fetchClinicQueue } from "@/lib/queue/server";

/**
 * GET /api/queue/screen?clinic=<uuid>
 * Public waiting-room display — no login (clinic id in URL acts as key).
 */
export async function GET(req: NextRequest) {
  try {
    const clinicId = req.nextUrl.searchParams.get("clinic")?.trim();
    if (!clinicId) {
      return NextResponse.json({ error: "معرّف العيادة مطلوب" }, { status: 400 });
    }

    const admin = getAdminClient();

    const { data: clinic } = await admin
      .from("clinics")
      .select("id, name_ar, name")
      .eq("id", clinicId)
      .maybeSingle();

    if (!clinic) {
      return NextResponse.json({ error: "العيادة غير موجودة" }, { status: 404 });
    }

    const queue = await fetchClinicQueue(clinicId, {
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
      clinicId,
      clinicName: clinic.name_ar || clinic.name || "العيادة",
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
