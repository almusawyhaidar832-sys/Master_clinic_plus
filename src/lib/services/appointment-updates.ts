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
  deliveryWarning?: string;
  providerMessageStatus?: string;
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
    messageType: `appointment_${input.action}`,
  });

  let finalOutcome = outcome;
  if (
    !outcome.ok &&
    outcome.configured &&
    (outcome.providerError === "whatsapp_not_linked" ||
      outcome.providerError?.includes("disconnected") ||
      outcome.providerError?.includes("not connected"))
  ) {
    await new Promise((r) => setTimeout(r, 1500));
    finalOutcome = await deliverWhatsAppMessage(admin, {
      clinicId: input.clinicId,
      rawPhone: phone,
      messageBody,
      messageType: `appointment_${input.action}_retry`,
    });
  }

  const delivered =
    finalOutcome.ok &&
    finalOutcome.status === "sent" &&
    !finalOutcome.deliveryWarning;

  if (input.appointmentId && delivered) {
    await admin
      .from("appointments")
      .update({ whatsapp_sent: true } as Record<string, boolean>)
      .eq("id", input.appointmentId)
      .eq("clinic_id", input.clinicId);
  }

  if (!finalOutcome.configured) {
    return {
      sent: false,
      skipped: true,
      error: "whatsapp_not_configured",
      messageBody,
    };
  }

  if (!finalOutcome.ok) {
    return {
      sent: false,
      error: finalOutcome.providerError ?? "whatsapp_send_failed",
      messageBody,
    };
  }

  if (!delivered) {
    const warn =
      finalOutcome.deliveryWarning ??
      finalOutcome.providerError ??
      "evolution_pending_delivery";
    return {
      sent: false,
      error: warn,
      messageBody,
      deliveryWarning: finalOutcome.deliveryWarning ?? warn,
      providerMessageStatus: finalOutcome.providerMessageStatus,
    };
  }

  return {
    sent: true,
    messageBody,
    providerMessageStatus: finalOutcome.providerMessageStatus,
  };
}
