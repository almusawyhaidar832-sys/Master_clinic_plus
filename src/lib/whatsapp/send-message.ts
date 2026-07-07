import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizePhoneForWhatsApp,
  validatePatientPhone,
} from "@/lib/phone";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";
import {
  resolveEvolutionSession,
  sendEvolutionDocument,
  sendEvolutionText,
} from "@/lib/whatsapp/evolution-client";
import { resolveWhatsAppInstanceForClinic } from "@/lib/whatsapp/resolve-instance";

export type WhatsAppDeliveryStatus = "sent" | "pending" | "failed";

export interface WhatsAppSendOutcome {
  ok: boolean;
  normalizedPhone: string;
  status: WhatsAppDeliveryStatus;
  providerError?: string;
  providerStatus?: number;
  providerMessageStatus?: string;
  deliveryWarning?: string;
  configured: boolean;
}

const LOG_PREFIX = "[whatsapp]";

/** Evolution يرفض أحياناً أسماء ملفات عربية — نستخدم ASCII آمن */
function safeWhatsAppFileName(name: string, fallback: string): string {
  const base = String(name ?? "")
    .trim()
    .replace(/[^\w.\-()+\s]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const withExt = base.toLowerCase().endsWith(".pdf")
    ? base
    : `${base || fallback}.pdf`;
  return withExt.replace(/[^\x20-\x7E]/g, "") || `${fallback}.pdf`;
}

/**
 * Normalize, call provider, log failures (visible in hosting / Supabase Edge logs).
 */
export async function deliverWhatsAppMessage(
  supabase: SupabaseClient,
  params: {
    clinicId: string;
    rawPhone: string;
    messageBody: string;
    messageType: string;
  }
): Promise<WhatsAppSendOutcome> {
  let normalizedPhone = normalizePhoneForWhatsApp(params.rawPhone);
  if (!normalizedPhone) {
    const retry = validatePatientPhone(params.rawPhone);
    if (retry.ok) normalizedPhone = retry.normalized;
  }
  if (!normalizedPhone || normalizedPhone.length < 12) {
    const err = "invalid_phone_after_normalize";
    console.error(LOG_PREFIX, params.messageType, err, {
      raw: params.rawPhone,
      normalized: normalizedPhone,
    });
    await logWhatsAppRow(supabase, {
      ...params,
      recipient_phone: params.rawPhone,
      status: "failed",
      error_message: err,
    });
    return {
      ok: false,
      normalizedPhone: normalizedPhone || params.rawPhone,
      status: "failed",
      providerError: err,
      configured: Boolean(process.env.WHATSAPP_API_URL),
    };
  }

  const cfg = getWhatsAppConfig();
  const configured = cfg.configured;

  if (!configured) {
    console.warn(LOG_PREFIX, "WHATSAPP_API_URL not set — message queued as pending");
    await logWhatsAppRow(supabase, {
      ...params,
      recipient_phone: normalizedPhone,
      status: "pending",
    });
    return { ok: true, normalizedPhone, status: "pending", configured: false };
  }

  let providerError: string | undefined;
  let providerStatus: number | undefined;

  try {
    if (cfg.provider === "evolution") {
      const instanceName = await resolveWhatsAppInstanceForClinic(params.clinicId);
      const session = await resolveEvolutionSession(instanceName);
      if (!session.linked) {
        const err = "whatsapp_not_linked";
        console.error(LOG_PREFIX, params.messageType, err, { instanceName });
        await logWhatsAppRow(supabase, {
          ...params,
          recipient_phone: normalizedPhone,
          status: "failed",
          error_message: err,
        });
        return {
          ok: false,
          normalizedPhone,
          status: "failed",
          providerError: err,
          configured: true,
        };
      }

      const evo = await sendEvolutionText(normalizedPhone, params.messageBody, {
        clinicId: params.clinicId,
        instanceName,
      });
      providerStatus = evo.status;
      if (!evo.ok) {
        providerError = evo.error ?? `HTTP ${evo.status}`;
        console.error(LOG_PREFIX, params.messageType, "evolution_error", {
          status: evo.status,
          error: providerError,
          phone: normalizedPhone,
        });
        await logWhatsAppRow(supabase, {
          ...params,
          recipient_phone: normalizedPhone,
          status: "failed",
          error_message: providerError,
        });
        return {
          ok: false,
          normalizedPhone,
          status: "failed",
          providerError,
          providerStatus,
          configured: true,
        };
      }
    } else {
      const res = await fetch(`${cfg.baseUrl}/message/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          phone: normalizedPhone,
          message: params.messageBody,
        }),
      });

      providerStatus = res.status;
      const text = await res.text().catch(() => "");

      if (!res.ok) {
        providerError = text || `HTTP ${res.status}`;
        console.error(LOG_PREFIX, params.messageType, "legacy_provider_error", {
          status: res.status,
          body: text.slice(0, 500),
          phone: normalizedPhone,
        });
        await logWhatsAppRow(supabase, {
          ...params,
          recipient_phone: normalizedPhone,
          status: "failed",
          error_message: providerError,
        });
        return {
          ok: false,
          normalizedPhone,
          status: "failed",
          providerError,
          providerStatus,
          configured: true,
        };
      }
    }

    await logWhatsAppRow(supabase, {
      ...params,
      recipient_phone: normalizedPhone,
      status: "sent",
    });
    return {
      ok: true,
      normalizedPhone,
      status: "sent",
      configured: true,
    };
  } catch (e) {
    providerError = e instanceof Error ? e.message : String(e);
    console.error(LOG_PREFIX, params.messageType, "network_error", {
      error: providerError,
      phone: normalizedPhone,
    });
    await logWhatsAppRow(supabase, {
      ...params,
      recipient_phone: normalizedPhone,
      status: "failed",
      error_message: providerError,
    });
    return {
      ok: false,
      normalizedPhone,
      status: "failed",
      providerError,
      configured: true,
    };
  }
}

export async function deliverWhatsAppDocument(
  supabase: SupabaseClient,
  params: {
    clinicId: string;
    rawPhone: string;
    caption: string;
    messageType: string;
    pdfBase64: string;
    fileName: string;
  }
): Promise<WhatsAppSendOutcome> {
  let normalizedPhone = normalizePhoneForWhatsApp(params.rawPhone);
  if (!normalizedPhone) {
    const retry = validatePatientPhone(params.rawPhone);
    if (retry.ok) normalizedPhone = retry.normalized;
  }
  if (!normalizedPhone || normalizedPhone.length < 12) {
    const err = "invalid_phone_after_normalize";
    await logWhatsAppRow(supabase, {
      clinicId: params.clinicId,
      messageType: params.messageType,
      messageBody: params.caption,
      recipient_phone: params.rawPhone,
      status: "failed",
      error_message: err,
    });
    return {
      ok: false,
      normalizedPhone: normalizedPhone || params.rawPhone,
      status: "failed",
      providerError: err,
      configured: Boolean(process.env.WHATSAPP_API_URL),
    };
  }

  const cfg = getWhatsAppConfig();
  if (!cfg.configured) {
    await logWhatsAppRow(supabase, {
      clinicId: params.clinicId,
      messageType: params.messageType,
      messageBody: params.caption,
      recipient_phone: normalizedPhone,
      status: "pending",
    });
    return { ok: true, normalizedPhone, status: "pending", configured: false };
  }

  try {
    if (cfg.provider === "evolution") {
      const instanceName = await resolveWhatsAppInstanceForClinic(params.clinicId);
      const session = await resolveEvolutionSession(instanceName);
      if (!session.linked) {
        const err = "whatsapp_not_linked";
        await logWhatsAppRow(supabase, {
          clinicId: params.clinicId,
          messageType: params.messageType,
          messageBody: params.caption,
          recipient_phone: normalizedPhone,
          status: "failed",
          error_message: err,
        });
        return {
          ok: false,
          normalizedPhone,
          status: "failed",
          providerError: err,
          configured: true,
        };
      }

      const evo = await sendEvolutionDocument(
        normalizedPhone,
        {
          base64: params.pdfBase64,
          fileName: safeWhatsAppFileName(params.fileName, "document"),
          caption: params.caption,
        },
        { clinicId: params.clinicId, instanceName }
      );

      if (!evo.ok) {
        const providerError = evo.error ?? `HTTP ${evo.status}`;
        await logWhatsAppRow(supabase, {
          clinicId: params.clinicId,
          messageType: params.messageType,
          messageBody: params.caption,
          recipient_phone: normalizedPhone,
          status: "failed",
          error_message: providerError,
        });
        return {
          ok: false,
          normalizedPhone,
          status: "failed",
          providerError,
          providerStatus: evo.status,
          configured: true,
        };
      }
    } else {
      return {
        ok: false,
        normalizedPhone,
        status: "failed",
        providerError: "pdf_requires_evolution",
        configured: true,
      };
    }

    await logWhatsAppRow(supabase, {
      clinicId: params.clinicId,
      messageType: params.messageType,
      messageBody: params.caption,
      recipient_phone: normalizedPhone,
      status: "sent",
    });
    return { ok: true, normalizedPhone, status: "sent", configured: true };
  } catch (e) {
    const providerError = e instanceof Error ? e.message : String(e);
    await logWhatsAppRow(supabase, {
      clinicId: params.clinicId,
      messageType: params.messageType,
      messageBody: params.caption,
      recipient_phone: normalizedPhone,
      status: "failed",
      error_message: providerError,
    });
    return {
      ok: false,
      normalizedPhone,
      status: "failed",
      providerError,
      configured: true,
    };
  }
}

async function logWhatsAppRow(
  supabase: SupabaseClient,
  params: {
    clinicId: string;
    messageType: string;
    messageBody: string;
    recipient_phone: string;
    status: WhatsAppDeliveryStatus;
    error_message?: string;
  }
) {
  // error_message on pending rows = delivery warning code for support/debug
  const row: Record<string, unknown> = {
    clinic_id: params.clinicId,
    message_type: params.messageType,
    recipient_phone: params.recipient_phone,
    message_body_ar: params.messageBody,
    status: params.status,
    sent_at: params.status === "sent" ? new Date().toISOString() : null,
  };

  void supabase
    .from("whatsapp_messages")
    .insert(row)
    .then(({ error }) => {
      if (error) {
        console.error(LOG_PREFIX, "db_log_failed", error.message, params.messageType);
      }
    });

  if (params.error_message) {
    console.error(LOG_PREFIX, "delivery_failed", {
      type: params.messageType,
      phone: params.recipient_phone,
      error: params.error_message,
    });
  }
}
