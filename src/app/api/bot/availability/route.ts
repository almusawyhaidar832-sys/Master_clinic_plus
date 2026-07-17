import { NextRequest, NextResponse } from "next/server";
import { requireBotClinic } from "@/lib/integration/bot-route-helpers";
import { computeDoctorAvailability } from "@/lib/booking/availability";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/**
 * GET /api/bot/availability?doctorId=&date=YYYY-MM-DD&slotMinutes=30&from=09:00&to=21:00
 * الأوقات المتاحة لطبيب في يوم محدد — للاستخدام من N8N قبل الحجز.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireBotClinic(req);
    if (!auth.ok) return auth.response;
    const { clinicId, admin } = auth;

    const params = req.nextUrl.searchParams;
    const doctorId = params.get("doctorId")?.trim();
    const date = params.get("date")?.trim();
    const slotMinutesRaw = params.get("slotMinutes")?.trim();
    const from = params.get("from")?.trim();
    const to = params.get("to")?.trim();

    if (!doctorId) {
      return NextResponse.json({ error: "doctorId مطلوب" }, { status: 400 });
    }
    if (!date || !DATE_RE.test(date)) {
      return NextResponse.json({ error: "date غير صالح — استخدم YYYY-MM-DD" }, { status: 400 });
    }
    if (from && !TIME_RE.test(from)) {
      return NextResponse.json({ error: "from غير صالح — استخدم HH:MM" }, { status: 400 });
    }
    if (to && !TIME_RE.test(to)) {
      return NextResponse.json({ error: "to غير صالح — استخدم HH:MM" }, { status: 400 });
    }

    const { data: doctor } = await admin
      .from("doctors")
      .select("id, full_name_ar")
      .eq("id", doctorId)
      .eq("clinic_id", clinicId)
      .eq("is_active", true)
      .maybeSingle();

    if (!doctor) {
      return NextResponse.json({ error: "الطبيب غير موجود في هذه العيادة" }, { status: 404 });
    }

    const result = await computeDoctorAvailability(admin, {
      clinicId,
      doctorId,
      date,
      slotMinutes: slotMinutesRaw ? Number(slotMinutesRaw) : undefined,
      fromTime: from,
      toTime: to,
    });

    return NextResponse.json({
      date,
      doctor_id: doctorId,
      doctor_name: doctor.full_name_ar,
      slot_minutes: result.slotMinutes,
      from: result.fromTime,
      to: result.toTime,
      available_slots: result.availableSlots.map((s) => ({ start: s.start, end: s.end })),
      busy_slots: result.busySlots,
    });
  } catch (err) {
    console.error("[api/bot/availability]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "تعذر حساب الأوقات المتاحة" },
      { status: 500 }
    );
  }
}
