import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppointmentUpdateAction } from "@/lib/whatsapp";
import type { ClinicIntegrationRow, WebhookDispatchResult } from "@/lib/integration/types";
import { dispatchClinicWebhook } from "@/lib/integration/webhook-dispatch";

/** action محلي في appointment-updates.ts → اسم الحدث المتفق عليه مع N8N */
const ACTION_EVENT_MAP: Record<AppointmentUpdateAction, string> = {
  submitted: "appointment.submitted",
  accepted: "appointment.accepted",
  rejected: "appointment.rejected",
  modified: "appointment.modified",
  created: "appointment.created",
};

const DEFAULT_STATUS_MAP: Record<AppointmentUpdateAction, string> = {
  submitted: "pending",
  accepted: "confirmed",
  rejected: "cancelled",
  modified: "confirmed",
  created: "confirmed",
};

export interface AppointmentWebhookInput {
  clinicName: string | null;
  clinicAddress: string | null;
  appointmentId: string | null;
  patientName: string;
  patientPhone: string;
  doctorName: string;
  appointmentDate: string;
  startTime: string;
  endTime: string;
  action: AppointmentUpdateAction;
  reasonForChange?: string | null;
  resultingStatus?: string | null;
  /** يسمح لبعض المسارات (مثل الإلغاء) بإرسال حدث مختلف عن الخريطة الافتراضية */
  eventOverride?: string | null;
  /** staff | online | whatsapp_bot — يسمح لـ N8N بتجنّب الرد على حجزه هو نفسه */
  source?: string | null;
}

/** يبني ويُرسل webhook حدث موعد بصيغة موحّدة إلى N8N — لا يرمي أبداً */
export async function dispatchAppointmentWebhook(
  admin: SupabaseClient,
  integration: ClinicIntegrationRow | null,
  input: AppointmentWebhookInput
): Promise<WebhookDispatchResult> {
  const event = input.eventOverride?.trim() || ACTION_EVENT_MAP[input.action];

  return dispatchClinicWebhook(admin, integration, event, {
    appointment_id: input.appointmentId,
    patient_name: input.patientName,
    patient_phone: input.patientPhone,
    doctor_name: input.doctorName,
    appointment_date: input.appointmentDate,
    start_time: input.startTime,
    end_time: input.endTime,
    status: input.resultingStatus?.trim() || DEFAULT_STATUS_MAP[input.action],
    reason_for_change: input.reasonForChange?.trim() || null,
    clinic_name: input.clinicName,
    clinic_address: input.clinicAddress,
    source: input.source?.trim() || null,
  });
}
