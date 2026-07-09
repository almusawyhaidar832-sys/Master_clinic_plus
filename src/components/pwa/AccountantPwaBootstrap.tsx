"use client";

import { useEffect } from "react";
import {
  refreshAccountantWebPushIfGranted,
  listenForPushResubscribe,
  registerAccountantWebPush,
} from "@/lib/push/client";
import { warmAccountantShellCache } from "@/lib/pwa/accountant-shell-cache";
import { prefetchForCurrentAccountantPortal } from "@/lib/offline/patient-profile-prefetch";
import { ensureNotificationPermission } from "@/lib/queue/realtime-client";
import {
  hasPersistedAudioConsent,
  installGlobalAudioUnlock,
  unlockQueueAudio,
} from "@/lib/queue/audio-alerts";
import {
  hasPersistedSpeechUnlock,
  prepareSpeechAuto,
} from "@/lib/queue/web-speech";

/**
 * عند دخول بوابة المحاسب: كاش offline + إعادة تسجيل Push + النداء الصوتي.
 */
export function AccountantPwaBootstrap() {
  useEffect(() => {
    if (hasPersistedAudioConsent() || hasPersistedSpeechUnlock()) {
      prepareSpeechAuto();
      void unlockQueueAudio();
    }

    return installGlobalAudioUnlock(() => {
      prepareSpeechAuto();
      void unlockQueueAudio();
      void ensureNotificationPermission()
        .then((granted) => {
          if (granted) {
            void registerAccountantWebPush(false).catch(() => undefined);
          }
        })
        .catch(() => undefined);
    });
  }, []);

  useEffect(() => {
    void warmAccountantShellCache();
    void prefetchForCurrentAccountantPortal();

    const onOnline = () => {
      void warmAccountantShellCache();
      void prefetchForCurrentAccountantPortal();
    };

    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;

    if (Notification.permission === "granted") {
      prepareSpeechAuto();
      void unlockQueueAudio();
      void registerAccountantWebPush(false).catch(() => undefined);
    }

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
