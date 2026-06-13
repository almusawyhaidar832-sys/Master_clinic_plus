"use client";

import { useEffect } from "react";

/**
 * Registers the PWA service worker early — required for Android installability.
 * Does not intercept the browser install prompt (no custom install UI).
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* registration optional in dev */
    });
  }, []);

  return null;
}
