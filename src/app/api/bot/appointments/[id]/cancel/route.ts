import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireBotClinic } from "@/lib/integration/bot-route-helpers";
import { cancelBotAppointment } from "@/lib/services/bot-appointments-server";

const bodySchema = z.object({
  patientPhone: z.string().min(10, "رقم الجوال مطلوب للتحقق من صاحب الموعد"),
  reason: z.string().optional().nullable(),
});

/** PATCH /api/bot/appointments/[id]/cancel — إلغاء موعد من المراجع عبر البوت (N8N) */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireBotClinic(req);
    if (!auth.ok) return auth.response;
    const { clinicId, admin } = auth;

    const { id } = await params;
    if (!id?.trim()) {
      return NextResponse.json({ error: "معرّف الموعد مطلوب" }, { status: 400 });
    }

    const json = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message ?? "بيانات غير صالحة";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    await cancelBotAppointment(
      admin,
      clinicId,
      id,
      parsed.data.patientPhone,
      parsed.data.reason
    );

    return NextResponse.json({ success: true, message: "تم إلغاء الموعد" });
  } catch (err) {
    console.error("[api/bot/appointments/[id]/cancel]", err);
    const message = err instanceof Error ? err.message : "تعذر إلغاء الموعد";
    const status = message.includes("غير") || message.includes("لا يمكن") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
