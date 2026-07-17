import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhoneForWhatsApp, validatePatientPhone } from "@/lib/phone";
import { sendAppointmentUpdate } from "@/lib/services/appointment-updates";
import { syncQueueFromAppointmentStatus } from "@/lib/services/appointment-queue-sync";
import type { Appointment } from "@/types";

async function fetchDoctorName(
  admin: SupabaseClient,
  doctorId: string
): Promise<string> {
  const { data } = await admin
    .from("doctors")
    .select("full_name_ar")
    .eq("id", doctorId)
    .maybeSingle();
  return (data?.full_name_ar as string) || "الطبيب";
}

/** مواعيد قادمة لمراجع بهاتفه — لعيادة واحدة (N8N Bot) */
export async function listBotAppointmentsByPhone(
  admin: SupabaseClient,
  clinicId: string,
  rawPhone: string
): Promise<Appointment[]> {
  const check = validatePatientPhone(rawPhone);
  const normalized = check.ok ? check.normalized : normalizePhoneForWhatsApp(rawPhone);
  if (!normalized) return [];

  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await admin
    .from("appointments")
    .select(
      "id, clinic_id, doctor_id, patient_name_ar, patient_phone, appointment_date, start_time, end_time, status, notes, doctor:doctors(full_name_ar)"
    )
    .eq("clinic_id", clinicId)
    .eq("patient_phone", normalized)
    .gte("appointment_date", today)
    .neq("status", "cancelled")
    .order("appointment_date")
    .order("start_time");

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Appointment[];
}

const BOT_CANCELLABLE_STATUSES = new Set([
  "pending",
  "scheduled",
  "confirmed",
  "waiting",
]);

/**
 * إلغاء موعد من المراجع نفسه عبر البوت — يتطلب تطابق رقم الهاتف مع سجل الموعد
 * (لا صلاحيات موظف هنا، فقط مفتاح API للعيادة + رقم هاتف يطابق الحجز).
 */
export async function cancelBotAppointment(
  admin: SupabaseClient,
  clinicId: string,
  appointmentId: string,
  patientPhone: string,
  reason?: string | null
): Promise<Appointment> {
  const phoneCheck = validatePatientPhone(patientPhone);
  if (!phoneCheck.ok) throw new Error(phoneCheck.message);

  const { data: current } = await admin
    .from("appointments")
    .select("*")
    .eq("id", appointmentId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (!current) throw new Error("الموعد غير موجود");

  const currentPhoneNormalized =
    normalizePhoneForWhatsApp(String(current.patient_phone ?? "")) ||
    String(current.patient_phone ?? "");
  if (currentPhoneNormalized !== phoneCheck.normalized) {
    throw new Error("رقم الهاتف لا يطابق صاحب هذا الموعد");
  }

  if (!BOT_CANCELLABLE_STATUSES.has(current.status as string)) {
    throw new Error("لا يمكن إلغاء هذا الموعد — الحالة الحالية لا تسمح بالإلغاء");
  }

  const { data, error } = await admin
    .from("appointments")
    .update({
      status: "cancelled",
      reason_for_change: reason?.trim() || "طلب المراجع الإلغاء عبر واتساب",
    })
    .eq("id", appointmentId)
    .eq("clinic_id", clinicId)
    .in("status", [...BOT_CANCELLABLE_STATUSES])
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error("تعذّر الإلغاء — تغيّرت حالة الموعد قبل الحفظ");
  }

  await syncQueueFromAppointmentStatus(admin, appointmentId, clinicId, "cancelled");

  const doctorName = await fetchDoctorName(admin, data.doctor_id as string);
  await sendAppointmentUpdate(admin, {
    clinicId,
    appointmentId: data.id as string,
    patientPhone: data.patient_phone as string,
    patientName: data.patient_name_ar as string,
    doctorName,
    appointmentDate: data.appointment_date as string,
    startTime: data.start_time as string,
    endTime: data.end_time as string,
    action: "rejected",
    reasonForChange: reason?.trim() || "طلب المراجع الإلغاء عبر واتساب",
    resultingStatus: "cancelled",
    eventOverride: "appointment.cancelled",
    source: (data.source as string | null) ?? null,
  });

  return data as Appointment;
}
