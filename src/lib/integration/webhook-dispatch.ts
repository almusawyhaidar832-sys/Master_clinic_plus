import "server-only";

import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ClinicIntegrationRow,
  WebhookDispatchResult,
  WebhookEnvelope,
} from "@/lib/integration/types";
import { isN8nBotProvider } from "@/lib/integration/resolve-provider";

const WEBHOOK_TIMEOUT_MS = 10_000;

export function signWebhookPayload(rawBody: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/** يُسجَّل في automation_outbox عند فشل الإرسال — طابور موجود مسبقاً لإعادة المحاولة */
async function queueForRetry(
  admin: SupabaseClient,
  clinicId: string,
  event: string,
  envelope: WebhookEnvelope,
  lastError: string
): Promise<void> {
  try {
    await admin.from("automation_outbox").insert({
      clinic_id: clinicId,
      event_type: `webhook:${event}`,
      payload: envelope as unknown as Record<string, unknown>,
      status: "pending",
      last_error: lastError,
    });
  } catch (e) {
    console.error("[webhook-dispatch] queueForRetry failed", e);
  }
}

/**
 * إرسال حدث موقّع (HMAC) إلى webhook_url الخاص بعيادة تستخدم N8N Bot.
 * لا يرمي أبداً — أي فشل يُسجَّل في automation_outbox للمحاولة لاحقاً ويُرجع ok:false.
 */
export async function dispatchClinicWebhook(
  admin: SupabaseClient,
  integration: ClinicIntegrationRow | null,
  event: string,
  data: Record<string, unknown>
): Promise<WebhookDispatchResult> {
  if (!integration) return { ok: false, skipped: "not_configured" };
  if (!isN8nBotProvider(integration)) {
    return { ok: false, skipped: "provider_mismatch" };
  }
  if (!integration.webhook_url?.trim()) {
    return { ok: false, skipped: "not_configured" };
  }

  const envelope: WebhookEnvelope = {
    event,
    clinic_id: integration.clinic_id,
    idempotency_key: `evt_${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    data,
  };

  const rawBody = JSON.stringify(envelope);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-MC-Clinic-Id": integration.clinic_id,
    "X-MC-Event": event,
  };
  if (integration.webhook_secret?.trim()) {
    headers["X-MC-Signature"] = signWebhookPayload(rawBody, integration.webhook_secret.trim());
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(integration.webhook_url.trim(), {
        method: "POST",
        headers,
        body: rawBody,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = `HTTP ${res.status} ${text.slice(0, 300)}`;
      console.error("[webhook-dispatch]", event, err);
      await queueForRetry(admin, integration.clinic_id, event, envelope, err);
      return { ok: false, error: err };
    }

    return { ok: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    console.error("[webhook-dispatch] network_error", event, err);
    await queueForRetry(admin, integration.clinic_id, event, envelope, err);
    return { ok: false, error: err };
  }
}
