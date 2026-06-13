"use client";

import { authPortalHeaders } from "@/lib/auth/api-portal";
import { ensureServiceWorkerRegistration } from "@/lib/pwa/service-worker-ready";
import { getDoctorPushCapability } from "@/lib/pwa/platform";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export type PushRegisterResult =
  | { ok: true; subscribed: boolean }
  | {
      ok: false;
      reason:
        | "unsupported"
        | "ios-not-installed"
        | "denied"
        | "no-sw"
        | "subscribe-failed"
        | "server-failed";
    };

export function isWebPushSupported(): boolean {
  return getDoctorPushCapability().level === "full";
}

const PUSH_REGISTER_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> {
  return Promise.race([
    promise,
    new Promise<"timeout">((resolve) =>
      window.setTimeout(() => resolve("timeout"), ms)
    ),
  ]);
}

/** اشتراك Web Push لموبايل الطبيب — Android + iPhone (PWA مثبّت) */
export async function registerDoctorWebPush(
  requestPermission = false
): Promise<PushRegisterResult> {
  const run = async (): Promise<PushRegisterResult> => {
    const capability = getDoctorPushCapability();
    if (capability.level === "unsupported") {
      return { ok: false, reason: "unsupported" };
    }
    if (capability.level === "in-app-only") {
      return { ok: false, reason: "ios-not-installed" };
    }

    if (!("Notification" in window)) {
      return { ok: false, reason: "unsupported" };
    }

    if (Notification.permission === "denied") {
      return { ok: false, reason: "denied" };
    }

    if (Notification.permission === "default" && requestPermission) {
      const result = await Notification.requestPermission();
      if (result !== "granted") return { ok: false, reason: "denied" };
    } else if (Notification.permission !== "granted") {
      return { ok: false, reason: "denied" };
    }

    const registration = await ensureServiceWorkerRegistration();
    if (!registration) {
      return { ok: false, reason: "no-sw" };
    }

    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!.trim();

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      try {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
      } catch {
        return { ok: false, reason: "subscribe-failed" };
      }
    }

    try {
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...authPortalHeaders("doctor"),
        },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });

      if (!res.ok) return { ok: false, reason: "server-failed" };
      return { ok: true, subscribed: true };
    } catch {
      return { ok: false, reason: "server-failed" };
    }
  };

  const result = await withTimeout(run(), PUSH_REGISTER_TIMEOUT_MS);
  if (result === "timeout") {
    return { ok: false, reason: "no-sw" };
  }
  return result;
}

/** إعادة تسجيل Push عند العودة للتطبيق (iOS/Android) */
export async function refreshDoctorWebPushIfGranted(): Promise<void> {
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    Notification.permission !== "granted"
  ) {
    return;
  }
  await registerDoctorWebPush(false);
}

/** استمع لرسائل Service Worker — تشغيل النداء إذا التطبيق مفتوح بالخلفية */
export function listenForPushAlertMessages(
  onAlert: (payload: {
    title?: string;
    body?: string;
    url?: string;
    patientName?: string;
    kind?: string;
  }) => void
): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return () => {};
  }

  const handler = (event: MessageEvent) => {
    const data = event.data as { type?: string; payload?: unknown } | null;
    if (data?.type !== "QUEUE_PUSH_ALERT" || !data.payload) return;
    onAlert(data.payload as Parameters<typeof onAlert>[0]);
  };

  navigator.serviceWorker.addEventListener("message", handler);
  return () => navigator.serviceWorker.removeEventListener("message", handler);
}

/** فتح صفحة من Service Worker عند النقر على الإشعار */
export function listenForServiceWorkerNavigation(
  onNavigate: (url: string) => void
): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return () => {};
  }

  const handler = (event: MessageEvent) => {
    const data = event.data as { type?: string; url?: string } | null;
    if (data?.type !== "SW_NAVIGATE" || !data.url) return;
    onNavigate(data.url);
  };

  navigator.serviceWorker.addEventListener("message", handler);
  return () => navigator.serviceWorker.removeEventListener("message", handler);
}
