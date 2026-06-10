import { authPortalHeaders } from "@/lib/auth/api-portal";
import { notifyAppointmentMutation } from "@/lib/sync/mutation-notify";
import type { WhatsAppDeliveryResult } from "@/lib/whatsapp/delivery-errors";
import type { Appointment } from "@/types";

function syncAppointment(appointment?: Appointment) {
  if (!appointment?.clinic_id) return;
  notifyAppointmentMutation({
    clinicId: appointment.clinic_id,
    doctorId: appointment.doctor_id,
  });
}

async function parseJson<T>(res: Response): Promise<T & { error?: string }> {
  return res.json().catch(() => ({})) as Promise<T & { error?: string }>;
}

export async function createDoctorAppointmentViaApi(input: {
  patient_name_ar: string;
  patient_phone: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  notes?: string;
}): Promise<{
  ok: boolean;
  appointment?: Appointment;
  whatsapp?: WhatsAppDeliveryResult;
  error?: string;
}> {
  const res = await fetch("/api/doctor/appointments", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...authPortalHeaders("doctor"),
    },
    body: JSON.stringify(input),
  });
  const json = await parseJson<{
    appointment?: Appointment;
    whatsapp?: WhatsAppDeliveryResult;
  }>(res);
  if (!res.ok) return { ok: false, error: json.error ?? "تعذر إضافة الموعد" };
  syncAppointment(json.appointment);
  return {
    ok: true,
    appointment: json.appointment,
    whatsapp: json.whatsapp,
  };
}
