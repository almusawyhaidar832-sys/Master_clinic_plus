import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  appointmentUpdateMessage,
  type AppointmentUpdateAction,
} from "@/lib/whatsapp";
import {
  fetchClinicProfile,
  getClinicDisplayName,
} from "@/lib/services/clinic-profile";
import { deliverWhatsAppMessage } from "@/lib/whatsapp/send-message";
import { formatDate, formatTime } from "@/lib/utils";
import { getClinicIntegration, isN8nBotProvider } from "@/lib/integration/resolve-provider";
import { dispatchAppointmentWebhook } from "@/lib/integration/appointment-webhook";

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
  /** الحالة الفعلية بعد العملية (waiting/confirmed/cancelled...) — تُستخدم في webhook N8N فقط */
  resultingStatus?: string | null;
  /** يسمح بإرسال حدث مختلف عن الخريطة الافتراضية (مثل appointment.cancelled بدل rejected) */
  eventOverride?: string | null;
  /** staff | online | whatsapp_bot — يُمرَّر لـ N8N حتى يتجنّب الرد على حجزه هو نفسه */
  source?: string | null;
}

export interface SendAppointmentUpdateResult {
  sent: boolean;
  skipped?: boolean;
  error?: string;
  deliveryWarning?: string;
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

  // مسار N8N Bot — فقط للعيادات المفعّلة بوضوح (provider = n8n_bot). أي عيادة أخرى
  // (وهو الوضع الافتراضي لكل العيادات اليوم) تكمل عبر Evolution كما كانت بدون أي تغيير.
  const integration = await getClinicIntegration(admin, input.clinicId);
  if (isN8nBotProvider(integration)) {
    const dispatch = await dispatchAppointmentWebhook(admin, integration, {
      clinicName: clinic ? getClinicDisplayName(clinic) : null,
      clinicAddress: clinic?.address ?? null,
      appointmentId: input.appointmentId ?? null,
      patientName: input.patientName,
      patientPhone: phone,
      doctorName: input.doctorName,
      appointmentDate: input.appointmentDate,
      startTime: input.startTime,
      endTime: input.endTime,
      action: input.action,
      reasonForChange: input.reasonForChange,
      resultingStatus: input.resultingStatus,
      eventOverride: input.eventOverride,
      source: input.source,
    });

    if (input.appointmentId && dispatch.ok) {
      await admin
        .from("appointments")
        .update({ whatsapp_sent: true } as Record<string, boolean>)
        .eq("id", input.appointmentId)
        .eq("clinic_id", input.clinicId);
    }

    if (!dispatch.ok) {
      return {
        sent: false,
        error: dispatch.error ?? "n8n_webhook_failed",
        deliveryWarning: dispatch.error,
        messageBody,
      };
    }
    return { sent: true, messageBody };
  }

  const outcome = await deliverWhatsAppMessage(admin, {
    clinicId: input.clinicId,
    rawPhone: phone,
    messageBody,
    messageType: "appointment_confirmation",
  });

  if (input.appointmentId && outcome.ok && outcome.status === "sent") {
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
      deliveryWarning: outcome.deliveryWarning ?? outcome.providerError,
      messageBody,
    };
  }

  return { sent: true, messageBody };
}
