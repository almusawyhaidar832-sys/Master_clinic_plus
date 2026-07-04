import "server-only";

import webpush from "web-push";
import { getAdminClient } from "@/lib/supabase/admin";

export interface DoctorQueuePushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  patientName?: string;
  kind?: string;
  audioUrl?: string;
}

let vapidConfigured = false;

export function isWebPushConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() &&
      process.env.VAPID_PRIVATE_KEY?.trim()
  );
}

function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true;
  if (!isWebPushConfigured()) return false;

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT?.trim() || "mailto:support@masterclinic.local",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!.trim(),
    process.env.VAPID_PRIVATE_KEY!.trim()
  );
  vapidConfigured = true;
  return true;
}

export interface WebPushSendResult {
  attempted: number;
  sent: number;
  configured: boolean;
}

/** إرسال Web Push لكل أجهزة الطبيب — يعمل حتى لو التطبيق مغلق (PWA) */
export async function sendWebPushToProfile(
  profileId: string,
  payload: DoctorQueuePushPayload
): Promise<WebPushSendResult> {
  if (!ensureVapidConfigured()) {
    console.warn("[web-push] skipped — VAPID keys missing on server");
    return { attempted: 0, sent: 0, configured: false };
  }

  const admin = getAdminClient();
  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("profile_id", profileId);

  if (error) {
    if (error.message.includes("push_subscriptions")) {
      console.warn("[web-push] push_subscriptions table missing");
      return { attempted: 0, sent: 0, configured: true };
    }
    throw new Error(error.message);
  }
  if (!subs?.length) {
    console.warn("[web-push] no subscriptions for profile:", profileId);
    return { attempted: 0, sent: 0, configured: true };
  }

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/doctor/queue",
    tag: payload.tag ?? "doctor-queue",
    patientName: payload.patientName,
    kind: payload.kind ?? "doctor_queue",
    audioUrl: payload.audioUrl,
  });

  const pushOptions = {
    TTL: 86400,
    urgency: "high" as const,
  };

  let sent = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint as string,
            keys: {
              p256dh: sub.p256dh as string,
              auth: sub.auth as string,
            },
          },
          body,
          pushOptions
        );
        sent += 1;
      } catch (err: unknown) {
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode?: number }).statusCode)
            : 0;
        if (status === 404 || status === 410) {
          await admin.from("push_subscriptions").delete().eq("id", sub.id);
        } else {
          console.error("[web-push] send failed:", err);
        }
      }
    })
  );

  return { attempted: subs.length, sent, configured: true };
}
