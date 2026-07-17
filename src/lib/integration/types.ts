/** أنواع مشتركة لربط N8N Bot — طبقة إضافية لا تُغيّر سلوك النظام الحالي */

export type ClinicIntegrationProvider = "evolution" | "n8n_bot" | "disabled";

export interface ClinicIntegrationRow {
  id: string;
  clinic_id: string;
  provider: ClinicIntegrationProvider;
  bot_api_key_hash: string | null;
  bot_api_key_prefix: string | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  whatsapp_numbers: string[];
  is_active: boolean;
}

/** أحداث المواعيد المرسلة من Master Clinic إلى N8N (webhook صادر) */
export type AppointmentWebhookEvent =
  | "appointment.submitted"
  | "appointment.accepted"
  | "appointment.rejected"
  | "appointment.modified"
  | "appointment.cancelled"
  | "appointment.created";

export interface WebhookEnvelope<T = Record<string, unknown>> {
  event: string;
  clinic_id: string;
  idempotency_key: string;
  timestamp: string;
  data: T;
}

export interface WebhookDispatchResult {
  ok: boolean;
  skipped?: "not_configured" | "provider_mismatch" | "inactive";
  error?: string;
}
