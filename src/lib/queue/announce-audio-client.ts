"use client";

import { authPortalHeaders } from "@/lib/auth/api-portal";

export type QueueAnnounceVariant =
  | "accountant_admit"
  | "accountant_billing"
  | "queue_screen";

function resolveAnnouncePortal(): "accountant" | "doctor" | "assistant" {
  if (typeof window === "undefined") return "accountant";
  const path = window.location.pathname;
  if (path.startsWith("/doctor")) return "doctor";
  if (path.startsWith("/assistant")) return "assistant";
  return "accountant";
}

/** يطلب من السيرفر رابط MP3 موقّع — أوثق من POST /api/tts/speak */
export async function fetchQueueAnnounceAudioUrl(
  entryId: string,
  variant: QueueAnnounceVariant
): Promise<string | null> {
  try {
    const res = await fetch("/api/queue/announce-audio-url", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...authPortalHeaders(resolveAnnouncePortal()),
      },
      body: JSON.stringify({ entry_id: entryId, variant }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { audioUrl?: string };
    return data.audioUrl?.trim() || null;
  } catch {
    return null;
  }
}
