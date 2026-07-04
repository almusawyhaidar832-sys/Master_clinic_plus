"use client";

import { useEffect } from "react";
import { refreshDoctorWebPushIfGranted, listenForPushResubscribe } from "@/lib/push/client";
import { warmDoctorShellCache } from "@/lib/pwa/doctor-shell-cache";

/**
 * عند دخول بوابة الطبيب: كاش offline + إعادة تسجيل Push خارج التطبيق.
 */
export function DoctorPwaBootstrap() {
  useEffect(() => {
    void warmDoctorShellCache();

    const onOnline = () => {
      void warmDoctorShellCache();
    };

    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    const syncBackgroundPush = () => {
      void refreshDoctorWebPushIfGranted();
    };

    syncBackgroundPush();

    const onVisible = () => {
      if (document.visibilityState === "visible") syncBackgroundPush();
    };

    document.addEventListener("visibilitychange", onVisible);
    const resubCleanup = listenForPushResubscribe(() => {
      void refreshDoctorWebPushIfGranted();
    });

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      resubCleanup();
    };
  }, []);

  return null;
}
