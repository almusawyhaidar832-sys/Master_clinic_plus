import { NextRequest, NextResponse } from "next/server";
import { requireBotClinic } from "@/lib/integration/bot-route-helpers";
import { getProcessedEvent } from "@/lib/services/bot-processed-events-server";

/**
 * GET /api/bot/events/[idempotency_key] — هل هذا الحدث مُعالَج مسبقاً لهذه العيادة؟
 * 200 + السجل إن وُجد، أو 404 إن لم يوجد.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ idempotency_key: string }> }
) {
  try {
    const auth = await requireBotClinic(req);
    if (!auth.ok) return auth.response;
    const { clinicId, admin } = auth;

    const { idempotency_key } = await params;
    const key = idempotency_key?.trim();
    if (!key) {
      return NextResponse.json({ error: "idempotency_key مطلوب" }, { status: 400 });
    }

    const event = await getProcessedEvent(admin, clinicId, decodeURIComponent(key));
    if (!event) {
      return NextResponse.json({ error: "لا يوجد حدث بهذا المفتاح" }, { status: 404 });
    }

    return NextResponse.json({
      idempotency_key: event.idempotency_key,
      clinic_id: event.clinic_id,
      processed_at: event.processed_at,
    });
  } catch (err) {
    console.error("[api/bot/events/[idempotency_key] GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "تعذر تحميل الحدث" },
      { status: 500 }
    );
  }
}
