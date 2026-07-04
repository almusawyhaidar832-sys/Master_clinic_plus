"use client";

import { useEffect } from "react";
import {
  refreshAccountantWebPushIfGranted,
  listenForPushResubscribe,
} from "@/lib/push/client";
import { warmAccountantShellCache } from "@/lib/pwa/accountant-shell-cache";

/**
 * عند دخول بوابة المحاسب: كاش offline + إعادة تسجيل Push + النداء الصوتي.
 */
export function AccountantPwaBootstrap() {
  useEffect(() => {
    void warmAccountantShellCache();

    const onOnline = () => {
      void warmAccountantShellCache();
    };

    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    const syncBackgroundPush = () => {
      void refreshAccountantWebPushIfGranted();
    };

    syncBackgroundPush();

    const onVisible = () => {
      if (document.visibilityState === "visible") syncBackgroundPush();
    };

    document.addEventListener("visibilitychange", onVisible);
    const resubCleanup = listenForPushResubscribe(() => {
      void refreshAccountantWebPushIfGranted();
    });

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      resubCleanup();
    };
  }, []);

  return null;
}
