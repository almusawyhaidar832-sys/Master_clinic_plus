import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireBotClinic } from "@/lib/integration/bot-route-helpers";
import { createPublicBooking } from "@/lib/booking/server";
import { listBotAppointmentsByPhone } from "@/lib/services/bot-appointments-server";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 30;

const DEFAULT_SLOT_MINUTES = 30;

/**
 * مخطّط مرن — يقبل الحقول الرسمية (patientName/appointmentDate/startTime...) وأيضاً
 * أسماء بديلة تستخدمها بعض تدفقات N8N الجاهزة (name/phone/date كتاريخ ووقت كاملَين
 * ISO). هذا لا يغيّر أي سلوك حالي — الحقول الرسمية تبقى تعمل كما هي.
 */
const bodySchema = z.object({
  doctorId: z.string().uuid("معرّف الطبيب غير صالح").optional(),
  patientName: z.string().min(2).optional(),
  patientPhone: z.string().min(6).optional(),
  appointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  notes: z.string().optional().nullable(),
  slotMinutes: z.coerce.number().int().positive().max(240).optional(),
  // مرادفات (compat مع تدفقات N8N الجاهزة)
  name: z.string().optional(),
  phone: z.string().optional(),
  date: z.string().optional(),
});

function normalizeTime(t: string): string {
  return t.length === 5 ? `${t}:00` : t;
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const nh = Math.floor(((total % 1440) + 1440) % 1440 / 60);
  const nm = ((total % 60) + 60) % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}:00`;
}

/** يحاول تفكيك تاريخ/وقت كامل (ISO أو "YYYY-MM-DD HH:MM") إلى {date, time} */
function splitDateTime(value: string): { date: string; time: string } | null {
  const m = value
    .trim()
    .match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return { date: m[1], time: `${m[2]}:${m[3]}:${m[4] ?? "00"}` };
}

/** يختار طبيباً تلقائياً فقط عندما تملك العيادة طبيباً واحداً نشطاً — تجنّباً لأي لبس */
async function autoSelectDoctor(
  admin: SupabaseClient,
  clinicId: string
): Promise<{ id: string } | { error: string; doctors?: { id: string; name: string }[] }> {
  const { data: doctors } = await admin
    .from("doctors")
    .select("id, full_name_ar")
    .eq("clinic_id", clinicId)
    .eq("is_active", true)
    .order("full_name_ar");

  const list = doctors ?? [];
  if (list.length === 0) {
    return { error: "لا يوجد طبيب مفعّل في هذه العيادة" };
  }
  if (list.length === 1) {
    return { id: list[0].id as string };
  }
  return {
    error:
      "doctorId مطلوب — تحتوي العيادة على أكثر من طبيب. استخدم GET /api/bot/clinic للحصول على قائمة الأطباء",
    doctors: list.map((d) => ({ id: d.id as string, name: d.full_name_ar as string })),
  };
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
    const { clinicId, admin } = auth;

    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message ?? "بيانات غير صالحة";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const d = parsed.data;

    const patientName = d.patientName ?? d.name;
    const patientPhone = d.patientPhone ?? d.phone;
    if (!patientName || patientName.trim().length < 2) {
      return NextResponse.json({ error: "اسم المريض مطلوب" }, { status: 400 });
    }
    if (!patientPhone || patientPhone.trim().length < 6) {
      return NextResponse.json({ error: "رقم الجوال مطلوب" }, { status: 400 });
    }

    let appointmentDate = d.appointmentDate;
    let startTime = d.startTime;
    if ((!appointmentDate || !startTime) && d.date) {
      const split = splitDateTime(d.date);
      if (split) {
        appointmentDate = appointmentDate ?? split.date;
        startTime = startTime ?? split.time;
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(d.date.trim())) {
        appointmentDate = appointmentDate ?? d.date.trim();
      }
    }
    if (!appointmentDate) {
      return NextResponse.json({ error: "appointmentDate (أو date) مطلوب" }, { status: 400 });
    }
    if (!startTime) {
      return NextResponse.json({ error: "startTime (أو date بصيغة كاملة) مطلوب" }, { status: 400 });
    }

    const normalizedStart = normalizeTime(startTime);
    const endTime = d.endTime
      ? normalizeTime(d.endTime)
      : addMinutes(normalizedStart, d.slotMinutes ?? DEFAULT_SLOT_MINUTES);

    let doctorId = d.doctorId;
    if (!doctorId) {
      const auto = await autoSelectDoctor(admin, clinicId);
      if ("error" in auto) {
        return NextResponse.json({ error: auto.error, doctors: auto.doctors }, { status: 400 });
      }
      doctorId = auto.id;
    }

    const result = await createPublicBooking({
      clinicRef: clinicId,
      doctorId,
      patientName: patientName.trim(),
      patientPhone: patientPhone.trim(),
      appointmentDate,
      startTime: normalizedStart,
      endTime,
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
