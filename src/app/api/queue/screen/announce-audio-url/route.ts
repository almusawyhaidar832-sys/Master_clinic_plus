import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { resolveActiveClinicByRef } from "@/lib/queue/clinic-ref";
import { buildQueueAnnounceAudioUrl } from "@/lib/queue/queue-announce-audio-url";

/**
 * GET /api/queue/screen/announce-audio-url?clinic=<ref>&entry_id=<uuid>
 * رابط MP3 موقّع لشاشة الانتظار — بدون تسجيل دخول (مفتاح العيادة في الرابط).
 */
export async function GET(req: NextRequest) {
  try {
    const clinicRef = req.nextUrl.searchParams.get("clinic")?.trim();
    const entryId = req.nextUrl.searchParams.get("entry_id")?.trim() ?? "";

    if (!clinicRef || !entryId) {
      return NextResponse.json({ error: "معرّف العيادة والدور مطلوبان" }, { status: 400 });
    }

    const clinic = await resolveActiveClinicByRef(clinicRef);
    if (!clinic) {
      return NextResponse.json({ error: "العيادة غير موجودة" }, { status: 404 });
    }

    const admin = getAdminClient();
    const { data: entry, error } = await admin
      .from("patient_queue")
      .select("id, clinic_id")
      .eq("id", entryId)
      .eq("clinic_id", clinic.id)
      .maybeSingle();

    if (error || !entry) {
      return NextResponse.json({ error: "الدور غير موجود" }, { status: 404 });
    }

    const audioUrl = buildQueueAnnounceAudioUrl(entryId, "queue_screen");
    if (!audioUrl) {
      return NextResponse.json(
        { error: "تعذر إنشاء رابط الصوت" },
        { status: 500 }
      );
    }

    return NextResponse.json({ audioUrl });
  } catch (err) {
    console.error("[api/queue/screen/announce-audio-url]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
