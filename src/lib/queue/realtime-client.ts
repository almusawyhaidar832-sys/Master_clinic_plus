"use client";

import {
  announceArabicWithBeep,
  announcePatientCallImmediate,
  announcePatientCallWithBeep,
  speakArabic,
} from "@/lib/queue/web-speech";

/** Arabic voice announcement — متصفح فوري (بدون انتظار السحابة) */
export function announcePatientCall(
  patientName: string,
  doctorName: string,
  variant: "called" | "enter" = "called"
) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  void announcePatientCallWithBeep(patientName, doctorName, variant, {
    useCloud: false,
  });
}

/** إعادة النداء — فوري بدون طابور */
export function replayPatientCall(
  patientName: string,
  doctorName: string,
  variant: "called" | "enter" = "called"
) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  void announcePatientCallImmediate(patientName, doctorName, variant);
}

/** Speak without beep */
export function speakArabicOnly(text: string) {
  void speakArabic(text, { useCloud: false });
}

export function announceArabic(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  void announceArabicWithBeep(text, { useCloud: false });
}

export async function announceArabicAsync(text: string) {
  await announceArabicWithBeep(text, { useCloud: false });
}

/** Request browser notification permission (call once on user gesture if possible) */
export {
  ensureNotificationPermission,
  readNotificationPermission,
  refreshNotificationPermission,
  watchNotificationPermission,
} from "@/lib/pwa/notification-permission";

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
    requireInteraction: true,
    silent: false,
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

/** قناة شاشة انتظار المرضى (التلفاز) — منفصلة عن تنبيهات المحاسب */
export function clinicQueueScreenChannelName(clinicId: string) {
  return `queue-screen-${clinicId}`;
}
