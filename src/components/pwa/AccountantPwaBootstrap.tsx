"use client";

import { useEffect } from "react";
import {
  refreshAccountantWebPushIfGranted,
  listenForPushResubscribe,
  registerAccountantWebPush,
} from "@/lib/push/client";
import { warmAccountantShellCache } from "@/lib/pwa/accountant-shell-cache";
import {
  hasPersistedAudioConsent,
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
  }, []);

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
