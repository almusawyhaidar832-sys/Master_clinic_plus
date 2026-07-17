import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export interface AvailabilitySlot {
  start: string;
  end: string;
}

const DEFAULT_SLOT_MINUTES = 30;
const DEFAULT_FROM_TIME = "09:00";
const DEFAULT_TO_TIME = "21:00";

function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((v) => Number(v) || 0);
  return h * 60 + m;
}

function fromMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

/** يقتصر HH:MM من HH:MM:SS القادم من Postgres TIME */
function toHHMM(value: unknown): string {
  return String(value ?? "").slice(0, 5);
}

/**
 * الأوقات المتاحة لطبيب في تاريخ محدد — لا يوجد جدول دوام معرَّف اليوم، لذا نستخدم
 * نافذة عمل افتراضية (09:00–21:00) قابلة للتخصيص عبر from/to، ونستثني ما يتعارض مع
 * schedule_locks والمواعيد الحالية (بنفس منطق timesOverlap المستخدم في باقي النظام).
 */
export async function computeDoctorAvailability(
  admin: SupabaseClient,
  params: {
    clinicId: string;
    doctorId: string;
    date: string;
    slotMinutes?: number;
    fromTime?: string;
    toTime?: string;
  }
): Promise<{
  slotMinutes: number;
  fromTime: string;
  toTime: string;
  availableSlots: AvailabilitySlot[];
  busySlots: AvailabilitySlot[];
}> {
  const slotMinutes =
    params.slotMinutes && params.slotMinutes >= 5 && params.slotMinutes <= 240
      ? Math.round(params.slotMinutes)
      : DEFAULT_SLOT_MINUTES;
  const fromTime = params.fromTime?.trim() || DEFAULT_FROM_TIME;
  const toTime = params.toTime?.trim() || DEFAULT_TO_TIME;

  const [{ data: locks }, { data: appts }] = await Promise.all([
    admin
      .from("schedule_locks")
      .select("start_time, end_time")
      .eq("clinic_id", params.clinicId)
      .eq("doctor_id", params.doctorId)
      .eq("lock_date", params.date),
    admin
      .from("appointments")
      .select("start_time, end_time, status")
      .eq("clinic_id", params.clinicId)
      .eq("doctor_id", params.doctorId)
      .eq("appointment_date", params.date)
      .neq("status", "cancelled"),
  ]);

  const busyRanges: AvailabilitySlot[] = [
    ...(locks ?? []).map((l) => ({
      start: toHHMM(l.start_time),
      end: toHHMM(l.end_time),
    })),
    ...(appts ?? []).map((a) => ({
      start: toHHMM(a.start_time),
      end: toHHMM(a.end_time),
    })),
  ];

  const startMin = toMinutes(fromTime);
  const endMin = toMinutes(toTime);
  const availableSlots: AvailabilitySlot[] = [];

  for (let t = startMin; t + slotMinutes <= endMin; t += slotMinutes) {
    const slotStart = fromMinutes(t);
    const slotEnd = fromMinutes(t + slotMinutes);
    const overlapsBusy = busyRanges.some((r) =>
      timesOverlap(slotStart, slotEnd, r.start, r.end)
    );
    if (!overlapsBusy) {
      availableSlots.push({ start: slotStart, end: slotEnd });
    }
  }

  return { slotMinutes, fromTime, toTime, availableSlots, busySlots: busyRanges };
}
