"use client";

import { useEffect } from "react";

const SW_URL = "/sw.js";
const SW_SCOPE = "/";

/**
 * Registers the PWA service worker — required for Chrome "Install app" on Android.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    void navigator.serviceWorker
      .register(SW_URL, { scope: SW_SCOPE, updateViaCache: "none" })
      .then((registration) => {
        void registration.update();
        if (process.env.NODE_ENV === "development") {
          console.info("[PWA] Service worker registered", registration.scope);
        }
      })
      .catch((error: unknown) => {
        console.error("[PWA] Service worker registration failed:", error);
      });
  }, []);

  return null;
}
