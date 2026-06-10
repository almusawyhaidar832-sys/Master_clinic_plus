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

export async function createAccountantAppointmentViaApi(input: {
  doctor_id: string;
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
  const res = await fetch("/api/accountant/appointments", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...authPortalHeaders("accountant"),
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

export async function updateAccountantAppointmentViaApi(
  id: string,
  input: {
    patient_name_ar: string;
    patient_phone: string;
    appointment_date: string;
    start_time: string;
    end_time: string;
    notes?: string;
    reason_for_change: string;
  }
): Promise<{ ok: boolean; appointment?: Appointment; error?: string }> {
  const res = await fetch(`/api/accountant/appointments/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...authPortalHeaders("accountant"),
    },
    body: JSON.stringify(input),
  });
  const json = await parseJson<{ appointment?: Appointment }>(res);
  if (!res.ok) return { ok: false, error: json.error ?? "تعذر تعديل الموعد" };
  syncAppointment(json.appointment);
  return { ok: true, appointment: json.appointment };
}

export async function setAccountantAppointmentStatusViaApi(
  id: string,
  action: "accept" | "reject",
  reason_for_change?: string
): Promise<{ ok: boolean; appointment?: Appointment; error?: string }> {
  const res = await fetch(`/api/accountant/appointments/${id}/status`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...authPortalHeaders("accountant"),
    },
    body: JSON.stringify({ action, reason_for_change }),
  });
  const json = await parseJson<{ appointment?: Appointment }>(res);
  if (!res.ok) return { ok: false, error: json.error ?? "تعذر تحديث الحالة" };
  syncAppointment(json.appointment);
  return { ok: true, appointment: json.appointment };
}

export async function deleteAccountantAppointmentViaApi(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/accountant/appointments/${id}`, {
    method: "DELETE",
    credentials: "include",
    headers: authPortalHeaders("accountant"),
  });
  const json = await parseJson<{ error?: string }>(res);
  if (!res.ok) return { ok: false, error: json.error ?? "تعذر حذف الموعد" };
  return { ok: true };
}
