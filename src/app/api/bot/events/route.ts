import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireBotClinic } from "@/lib/integration/bot-route-helpers";
import { recordProcessedEvent } from "@/lib/services/bot-processed-events-server";

const bodySchema = z.object({
  idempotency_key: z.string().min(1, "idempotency_key مطلوب"),
  // يُقبَل ويُتجاهَل — العيادة تُحدَّد دوماً من مفتاح X-Bot-Api-Key، لا من الجسم
  clinic_id: z.string().optional(),
});

/**
 * POST /api/bot/events — تسجيل حدث كمُعالَج (idempotency عام، غير مرتبط بالمواعيد).
 * إذا كان idempotency_key مسجَّلاً مسبقاً لهذه العيادة، يرجع 200 بالسجل الموجود
 * بدون خطأ وبدون تكرار.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireBotClinic(req);
    if (!auth.ok) return auth.response;
    const { clinicId, admin } = auth;

    const json = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message ?? "بيانات غير صالحة";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const { record, created } = await recordProcessedEvent(
      admin,
      clinicId,
      parsed.data.idempotency_key.trim()
    );

    return NextResponse.json(
      {
        idempotency_key: record.idempotency_key,
        clinic_id: record.clinic_id,
        processed_at: record.processed_at,
        created,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[api/bot/events POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "تعذر تسجيل الحدث" },
      { status: 500 }
    );
  }
}
