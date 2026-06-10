import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createPublicBooking } from "@/lib/booking/server";

const bodySchema = z.object({
  clinic: z.string().min(1, "رمز العيادة مطلوب"),
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

/** POST /api/booking/appointments — public booking (clinic_id enforced server-side) */
export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message ?? "بيانات غير صالحة";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const d = parsed.data;
    const result = await createPublicBooking({
      clinicRef: d.clinic,
      doctorId: d.doctorId,
      patientName: d.patientName,
      patientPhone: d.patientPhone,
      appointmentDate: d.appointmentDate,
      startTime: normalizeTime(d.startTime),
      endTime: normalizeTime(d.endTime),
      notes: d.notes,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/booking/appointments]", err);
    const message = err instanceof Error ? err.message : "تعذر إتمام الحجز";
    const status = message.includes("غير") || message.includes("محجوز") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
