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

export interface PushSubscriptionStatus {
  configured: boolean;
  subscriptionCount: number;
  tableMissing?: boolean;
}

export type PushRegisterResult =
  | { ok: true; subscribed: boolean; serverSaved: boolean }
  | {
      ok: false;
      reason:
        | "unsupported"
        | "ios-not-installed"
        | "denied"
        | "no-sw"
        | "subscribe-failed"
        | "server-failed"
        | "server-not-saved";
    };

export function isWebPushSupported(): boolean {
  return getDoctorPushCapability().level === "full";
}

const PUSH_REGISTER_TIMEOUT_MS = 25_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> {
  return Promise.race([
    promise,
    new Promise<"timeout">((resolve) =>
      window.setTimeout(() => resolve("timeout"), ms)
    ),
  ]);
}

export async function fetchPushSubscriptionStatus(
  portal: "doctor" | "assistant" | "accountant" = "doctor"
): Promise<PushSubscriptionStatus | null> {
  try {
    const res = await fetch("/api/push/status", {
      credentials: "include",
      headers: authPortalHeaders(portal),
    });
    if (!res.ok) return null;
    return (await res.json()) as PushSubscriptionStatus;
  } catch {
    return null;
  }
}

async function savePushSubscription(
  subscription: PushSubscription,
  portal: "doctor" | "assistant" | "accountant" = "doctor"
): Promise<boolean> {
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...authPortalHeaders(portal),
    },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  return res.ok;
}

async function registerWebPushForPortal(
  portal: "doctor" | "assistant" | "accountant",
  requestPermission = false,
  options?: { forceResubscribe?: boolean }
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

    await navigator.serviceWorker.ready.catch(() => undefined);

    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!.trim();
    const serverStatus = await fetchPushSubscriptionStatus(portal);

    let subscription = await registration.pushManager.getSubscription();

    if (
      options?.forceResubscribe ||
      (subscription && serverStatus && serverStatus.subscriptionCount === 0)
    ) {
      try {
        await subscription?.unsubscribe();
      } catch {
        // ignore
      }
      subscription = null;
    }

    if (!subscription) {
      try {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
        });
      } catch (err) {
        console.error("[push] subscribe failed:", err);
        return { ok: false, reason: "subscribe-failed" };
      }
    }

    const saved = await savePushSubscription(subscription, portal);
    if (!saved) {
      return { ok: false, reason: "server-failed" };
    }

    const verified = await fetchPushSubscriptionStatus(portal);
    const serverSaved = (verified?.subscriptionCount ?? 0) > 0;
    if (!serverSaved) {
      return { ok: false, reason: "server-not-saved" };
    }

    return { ok: true, subscribed: true, serverSaved: true };
  };

  const result = await withTimeout(run(), PUSH_REGISTER_TIMEOUT_MS);
  if (result === "timeout") {
    return { ok: false, reason: "no-sw" };
  }
  return result;
}

/** اشتراك Web Push لموبايل الطبيب — Android + iPhone (PWA مثبّت) */
export async function registerDoctorWebPush(
  requestPermission = false,
  options?: { forceResubscribe?: boolean }
): Promise<PushRegisterResult> {
  return registerWebPushForPortal("doctor", requestPermission, options);
}

/** اشتراك Web Push لموبايل المساعد */
export async function registerAssistantWebPush(
  requestPermission = false,
  options?: { forceResubscribe?: boolean }
): Promise<PushRegisterResult> {
  return registerWebPushForPortal("assistant", requestPermission, options);
}

/** اشتراك Web Push لمحاسب العيادة */
export async function registerAccountantWebPush(
  requestPermission = false,
  options?: { forceResubscribe?: boolean }
): Promise<PushRegisterResult> {
  return registerWebPushForPortal("accountant", requestPermission, options);
}

/** إعادة تسجيل Push عند العودة للتطبيق (iOS/Android) */
export async function refreshDoctorWebPushIfGranted(): Promise<PushRegisterResult | null> {
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    Notification.permission !== "granted"
  ) {
    return null;
  }
  return registerDoctorWebPush(false);
}

export async function refreshAssistantWebPushIfGranted(): Promise<PushRegisterResult | null> {
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    Notification.permission !== "granted"
  ) {
    return null;
  }
  return registerAssistantWebPush(false);
}

export async function refreshAccountantWebPushIfGranted(): Promise<PushRegisterResult | null> {
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    Notification.permission !== "granted"
  ) {
    return null;
  }
  return registerAccountantWebPush(false);
}

/** إعادة اشتراك Push عند انتهاء الاشتراك (pushsubscriptionchange في SW) */
export function listenForPushResubscribe(onResubscribe: () => void): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return () => {};
  }

  const handler = (event: MessageEvent) => {
    const data = event.data as { type?: string } | null;
    if (data?.type !== "PUSH_RESUBSCRIBE") return;
    onResubscribe();
  };

  navigator.serviceWorker.addEventListener("message", handler);
  return () => navigator.serviceWorker.removeEventListener("message", handler);
}

/** استمع لرسائل Service Worker — تشغيل النداء إذا التطبيق مفتوح بالخلفية */
export function listenForPushAlertMessages(
  onAlert: (payload: {
    title?: string;
    body?: string;
    url?: string;
    patientName?: string;
    kind?: string;
    audioUrl?: string;
    tag?: string;
    entryId?: string;
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

/** خيارات إشعار مخصص — من React (التطبيق مفتوح أو بخلفية) */
export interface AppNotificationPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  kind?: string;
  patientName?: string;
  silent?: boolean;
  requireInteraction?: boolean;
  renotify?: boolean;
}

/**
 * إظهار إشعار مخصص من React عبر Service Worker.
 * يعمل عندما التطبيق مفتوح أو في تبويب بالخلفية — وليس عندما التطبيق مغلق بالكامل
 * (للحالة الأخيرة استخدم Web Push من السيرفر: sendWebPushToProfile).
 */
export async function showAppNotification(
  payload: AppNotificationPayload
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return false;
  }

  const registration = await ensureServiceWorkerRegistration();
  if (!registration) return false;

  await navigator.serviceWorker.ready.catch(() => undefined);

  const message = { type: "SHOW_APP_NOTIFICATION", payload };

  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage(message);
    return true;
  }

  try {
    await registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: payload.tag ?? "mcp-doctor",
      // renotify is standard but missing from the current TS DOM lib typings
      renotify: payload.renotify !== false,
      requireInteraction: payload.requireInteraction !== false,
      silent: payload.silent !== false,
      vibrate: [200, 100, 200, 100, 400],
      data: {
        url: payload.url ?? "/doctor/queue",
        kind: payload.kind ?? "custom",
        patientName: payload.patientName ?? null,
      },
    } as NotificationOptions & { renotify?: boolean });
    return true;
  } catch (err) {
    console.error("[notification] showAppNotification failed:", err);
    return false;
  }
}
