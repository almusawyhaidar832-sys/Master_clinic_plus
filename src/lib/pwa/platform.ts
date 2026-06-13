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

export type MobileBrowser = "edge" | "chrome" | "samsung" | "other";

/** Chromium-family browser — affects install/permission hint text. */
export function getMobileBrowser(): MobileBrowser {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/EdgA|EdgiOS|Edg\//i.test(ua)) return "edge";
  if (/SamsungBrowser/i.test(ua)) return "samsung";
  if (/Chrome/i.test(ua)) return "chrome";
  return "other";
}

export function getNotificationSettingsHintAr(): string {
  switch (getMobileBrowser()) {
    case "edge":
      return "من Edge: ⋮ → Settings → Site permissions → Notifications → Allow";
    case "chrome":
      return "من Chrome: ⋮ → Site settings → Notifications → Allow";
    case "samsung":
      return "من Samsung Internet: ⋮ → Settings → Sites and downloads → Notifications → Allow";
    default:
      return "من المتصفح: ⋮ → إعدادات الموقع → الإشعارات → السماح";
  }
}

export function getNotificationSettingsHintEn(): string {
  switch (getMobileBrowser()) {
    case "edge":
      return "Edge ⋮ → Settings → Site permissions → Notifications → Allow";
    case "chrome":
      return "Chrome ⋮ → Site settings → Notifications → Allow";
    case "samsung":
      return "Samsung Internet ⋮ → Settings → Notifications → Allow";
    default:
      return "Browser menu → Site settings → Notifications → Allow";
  }
}

export function getPwaInstallHintAr(): string {
  switch (getMobileBrowser()) {
    case "edge":
      return "من Edge: ⋮ → Apps → Install this site as an app";
    case "chrome":
      return "من Chrome: ⋮ → Install app";
    default:
      return "من المتصفح: ⋮ → تثبيت التطبيق / Install app";
  }
}

export function getPwaInstallHintEn(): string {
  switch (getMobileBrowser()) {
    case "edge":
      return "Edge ⋮ → Apps → Install this site as an app";
    case "chrome":
      return "Chrome ⋮ → Install app";
    default:
      return "Browser menu → Install app";
  }
}

export function backgroundPushNeedsInstalledApp(): boolean {
  return isAndroid() && !isStandalonePwa();
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
