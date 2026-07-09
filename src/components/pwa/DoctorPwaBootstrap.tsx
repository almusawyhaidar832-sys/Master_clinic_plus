"use client";

import { useEffect } from "react";
import {
  refreshDoctorWebPushIfGranted,
  listenForPushResubscribe,
  registerDoctorWebPush,
  fetchPushSubscriptionStatus,
} from "@/lib/push/client";
import { warmDoctorShellCache } from "@/lib/pwa/doctor-shell-cache";
import { prefetchForCurrentDoctorPortal } from "@/lib/offline/patient-profile-prefetch";
import { onOfflineReconnect } from "@/lib/offline/reconnect-coordinator";
import { isStandalonePwa } from "@/lib/pwa/platform";

/**
 * عند دخول بوابة الطبيب: كاش offline + إعادة تسجيل Push خارج التطبيق.
 */
export function DoctorPwaBootstrap() {
  useEffect(() => {
    const warm = () => {
      void warmDoctorShellCache();
      void prefetchForCurrentDoctorPortal();
    };

    warm();
    const unsubReconnect = onOfflineReconnect(warm);
    return unsubReconnect;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;

    const syncBackgroundPush = async () => {
      if (Notification.permission !== "granted") return;

      const status = await fetchPushSubscriptionStatus("doctor");
      const needsSubscription = (status?.subscriptionCount ?? 0) === 0;

      if (needsSubscription || isStandalonePwa()) {
        await registerDoctorWebPush(false, { forceResubscribe: needsSubscription });
        return;
      }

      await refreshDoctorWebPushIfGranted();
    };

    void syncBackgroundPush();

    const onVisible = () => {
      if (document.visibilityState === "visible") void syncBackgroundPush();
    };

    document.addEventListener("visibilitychange", onVisible);
    const resubCleanup = listenForPushResubscribe(() => {
      void registerDoctorWebPush(false, { forceResubscribe: true });
    });

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      resubCleanup();
    };
  }, []);

  return null;
}
