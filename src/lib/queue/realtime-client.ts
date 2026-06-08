"use client";

import { announceArabicWithBeep, speakArabic } from "@/lib/queue/web-speech";

/** Arabic voice announcement via Web Speech API */
export function announceArabic(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  void announceArabicWithBeep(text);
}

/** Same as announceArabic but waits (use after user click) */
export async function announceArabicAsync(text: string) {
  await announceArabicWithBeep(text);
}

/** Speak without beep */
export function speakArabicOnly(text: string) {
  void speakArabic(text);
}

/** Request browser notification permission (call once on user gesture if possible) */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

/** Show a native browser notification (works when tab is in background) */
export function showBrowserNotification(
  title: string,
  body: string,
  linkPath?: string
) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const n = new Notification(title, {
    body,
    icon: "/favicon.ico",
    tag: `queue-${Date.now()}`,
  });

  if (linkPath) {
    n.onclick = () => {
      window.focus();
      window.location.href = linkPath;
      n.close();
    };
  }
}

export function doctorQueueChannelName(doctorId: string) {
  return `queue-doctor-${doctorId}`;
}

export function clinicQueueChannelName(clinicId: string) {
  return `queue-clinic-${clinicId}`;
}

/** Separate channel for page list sync — avoids collision with alert listeners */
export function doctorQueueListChannelName(doctorId: string) {
  return `queue-doctor-list-${doctorId}`;
}

export function clinicQueueListChannelName(clinicId: string) {
  return `queue-clinic-list-${clinicId}`;
}
