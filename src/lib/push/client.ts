"use client";

import { authPortalHeaders } from "@/lib/auth/api-portal";

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

export function isWebPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim())
  );
}

/** اشتراك Web Push لموبايل الطبيب — يتطلب إذن الإشعارات */
export async function registerDoctorWebPush(
  requestPermission = false
): Promise<boolean> {
  if (!isWebPushSupported()) return false;

  if (!("Notification" in window)) return false;

  if (Notification.permission === "denied") return false;

  if (Notification.permission === "default" && requestPermission) {
    const result = await Notification.requestPermission();
    if (result !== "granted") return false;
  } else if (Notification.permission !== "granted") {
    return false;
  }

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!.trim();
  const registration = await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });
  }

  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...authPortalHeaders("doctor"),
    },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });

  return res.ok;
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
