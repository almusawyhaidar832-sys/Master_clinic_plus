import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireBotClinic } from "@/lib/integration/bot-route-helpers";
import { createPublicBooking } from "@/lib/booking/server";
import { listBotAppointmentsByPhone } from "@/lib/services/bot-appointments-server";

export const maxDuration = 30;

const bodySchema = z.object({
  doctorId: z.string().uuid("معرّف الطبيب غير صالح"),
  patientName: z.string().min(2, "اسم المريض مطلوب"),
  patientPhone: z.string().min(10, "رقم الجوال مطلوب"),
  appointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح"),
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "وقت البداية غير صالح"),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "وقت النهاية غير صالح"),
  notes: z.string().optional().nullable(),
});

function normalizeTime(t: string): string {
  return t.length === 5 ? `${t}:00` : t;
}

/** GET /api/bot/appointments?phone=+9647... — مواعيد مراجع قادمة (N8N) */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireBotClinic(req);
    if (!auth.ok) return auth.response;
    const { clinicId, admin } = auth;

    const phone = req.nextUrl.searchParams.get("phone")?.trim();
    if (!phone) {
      return NextResponse.json({ error: "phone مطلوب" }, { status: 400 });
    }

    const appointments = await listBotAppointmentsByPhone(admin, clinicId, phone);

    return NextResponse.json({
      appointments: appointments.map((a) => ({
        appointment_id: a.id,
        doctor_id: a.doctor_id,
        doctor_name:
          (a as unknown as { doctor?: { full_name_ar?: string } }).doctor?.full_name_ar ?? null,
        appointment_date: a.appointment_date,
        start_time: a.start_time,
        end_time: a.end_time,
        status: a.status,
        notes: a.notes,
      })),
    });
  } catch (err) {
    console.error("[api/bot/appointments GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "تعذر تحميل المواعيد" },
      { status: 500 }
    );
  }
}

/** POST /api/bot/appointments — حجز موعد جديد عبر بوت واتساب (N8N) */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireBotClinic(req);
    if (!auth.ok) return auth.response;
    const { clinicId } = auth;

    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message ?? "بيانات غير صالحة";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const d = parsed.data;
    const result = await createPublicBooking({
      clinicRef: clinicId,
      doctorId: d.doctorId,
      patientName: d.patientName,
      patientPhone: d.patientPhone,
      appointmentDate: d.appointmentDate,
      startTime: normalizeTime(d.startTime),
      endTime: normalizeTime(d.endTime),
      notes: d.notes,
      source: "whatsapp_bot",
    });

    return NextResponse.json({
      appointment_id: result.appointmentId,
      status: "pending",
      message: "تم تسجيل موعدك بنجاح، بانتظار تأكيد العيادة",
    });
  } catch (err) {
    console.error("[api/bot/appointments POST]", err);
    const message = err instanceof Error ? err.message : "تعذر إتمام الحجز";
    const status = message.includes("غير") || message.includes("محجوز") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
