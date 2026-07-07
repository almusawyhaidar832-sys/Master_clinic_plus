import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  appointmentUpdateMessage,
  type AppointmentUpdateAction,
} from "@/lib/whatsapp";
import { fetchClinicProfile } from "@/lib/services/clinic-profile";
import { deliverWhatsAppMessage } from "@/lib/whatsapp/send-message";
import { formatDate, formatTime } from "@/lib/utils";

export type { AppointmentUpdateAction };

export interface SendAppointmentUpdateInput {
  clinicId: string;
  patientPhone: string | null;
  patientName: string;
  doctorName: string;
  appointmentDate: string;
  startTime: string;
  endTime: string;
  action: AppointmentUpdateAction;
  reasonForChange?: string | null;
  appointmentId?: string;
}

export interface SendAppointmentUpdateResult {
  sent: boolean;
  skipped?: boolean;
  error?: string;
  messageBody?: string;
}

/**
 * إرسال تحديث موعد للمريض عبر واتساب (Webhook / API داخلي).
 * يُستدعى تلقائياً عند قبول، رفض، أو تعديل الموعد.
 */
export async function sendAppointmentUpdate(
  admin: SupabaseClient,
  input: SendAppointmentUpdateInput
): Promise<SendAppointmentUpdateResult> {
  const phone = input.patientPhone?.trim();
  if (!phone) {
    return { sent: false, skipped: true, error: "no_patient_phone" };
  }

  const clinic = await fetchClinicProfile(admin, input.clinicId);
  const messageBody = appointmentUpdateMessage({
    patientName: input.patientName || "عميلنا",
    date: formatDate(input.appointmentDate),
    time: formatTime(input.startTime),
    endTime: formatTime(input.endTime),
    doctorName: input.doctorName,
    clinic,
    action: input.action,
    reasonForChange: input.reasonForChange,
  });

  const outcome = await deliverWhatsAppMessage(admin, {
    clinicId: input.clinicId,
    rawPhone: phone,
    messageBody,
    messageType: "appointment_confirmation",
  });

  if (input.appointmentId && outcome.ok) {
    await admin
      .from("appointments")
      .update({ whatsapp_sent: true } as Record<string, boolean>)
      .eq("id", input.appointmentId)
      .eq("clinic_id", input.clinicId);
  }

  if (!outcome.configured) {
    return {
      sent: false,
      skipped: true,
      error: "whatsapp_not_configured",
      messageBody,
    };
  }

  if (!outcome.ok) {
    return {
      sent: false,
      error: outcome.providerError ?? "whatsapp_send_failed",
      messageBody,
    };
  }

  return { sent: true, messageBody };
}
