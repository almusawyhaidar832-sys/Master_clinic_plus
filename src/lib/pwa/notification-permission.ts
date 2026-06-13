"use client";

export type NotificationPermissionSnapshot = {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  granted: boolean;
};

/** Read current notification permission from the browser. */
export function readNotificationPermission(): NotificationPermissionSnapshot {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return { supported: false, permission: "unsupported", granted: false };
  }

  const permission = Notification.permission;
  return {
    supported: true,
    permission,
    granted: permission === "granted",
  };
}

/** Sync with Permissions API — reflects site settings changes on Chrome/Android. */
export async function refreshNotificationPermission(): Promise<NotificationPermissionSnapshot> {
  const direct = readNotificationPermission();
  if (!direct.supported || direct.granted) return direct;

  try {
    if ("permissions" in navigator && navigator.permissions?.query) {
      const status = await navigator.permissions.query({
        name: "notifications" as PermissionName,
      });
      if (status.state === "granted") {
        return { supported: true, permission: "granted", granted: true };
      }
      if (status.state === "denied") {
        return { supported: true, permission: "denied", granted: false };
      }
    }
  } catch {
    // notifications query unsupported (Safari, some WebViews)
  }

  return readNotificationPermission();
}

/**
 * Request notification permission on user gesture.
 * Always trusts `Notification.permission` after the prompt — Safari/iOS may
 * resolve the promise with "default" even when permission was granted.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  let snap = await refreshNotificationPermission();
  if (!snap.supported) return false;
  if (snap.granted) return true;

  if (snap.permission === "denied") {
    snap = await refreshNotificationPermission();
    if (snap.granted) return true;
    return false;
  }

  try {
    if (typeof Notification.requestPermission === "function") {
      const maybePromise = Notification.requestPermission();
      if (maybePromise && typeof (maybePromise as Promise<string>).then === "function") {
        await maybePromise;
      }
    }
  } catch {
    // fall through to permission re-read
  }

  snap = readNotificationPermission();
  if (snap.granted) return true;

  snap = await refreshNotificationPermission();
  return snap.granted;
}

/** Listen for permission changes after user edits browser settings. */
export function watchNotificationPermission(
  onChange: (snap: NotificationPermissionSnapshot) => void
): () => void {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return () => {};
  }

  let disposed = false;
  let permissionStatus: PermissionStatus | null = null;

  const emit = () => {
    if (!disposed) void refreshNotificationPermission().then(onChange);
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") emit();
  };

  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", emit);
  window.addEventListener("pageshow", emit);

  void navigator.permissions
    ?.query({ name: "notifications" as PermissionName })
    .then((status) => {
      permissionStatus = status;
      status.addEventListener("change", emit);
    })
    .catch(() => {});

  return () => {
    disposed = true;
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", emit);
    window.removeEventListener("pageshow", emit);
    permissionStatus?.removeEventListener("change", emit);
  };
}

/** Stable snapshot for useSyncExternalStore — reads live browser permission. */
export function getNotificationPermissionKey(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

export function subscribeNotificationPermission(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const notify = () => onStoreChange();

  const unwatch = watchNotificationPermission(() => notify());

  const interval = window.setInterval(() => {
    notify();
  }, 2_000);

  return () => {
    window.clearInterval(interval);
    unwatch();
  };
}
