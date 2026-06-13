/** Detect mobile platform and PWA context for doctor alerts. */

export function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android/i.test(navigator.userAgent);
}

export type DoctorPushCapability =
  | { level: "full" }
  | { level: "in-app-only"; reason: "ios-not-installed" }
  | { level: "unsupported"; reason: "no-vapid" | "no-api" };

/** Whether background Web Push can work on this device/browser. */
export function getDoctorPushCapability(): DoctorPushCapability {
  if (typeof window === "undefined") {
    return { level: "unsupported", reason: "no-api" };
  }
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim()
  ) {
    return { level: "unsupported", reason: "no-vapid" };
  }
  if (isIOS() && !isStandalonePwa()) {
    return { level: "in-app-only", reason: "ios-not-installed" };
  }
  return { level: "full" };
}
