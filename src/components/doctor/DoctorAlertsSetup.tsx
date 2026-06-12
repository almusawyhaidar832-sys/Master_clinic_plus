"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { ensureNotificationPermission } from "@/lib/queue/realtime-client";
import {
  isWebPushSupported,
  listenForPushAlertMessages,
  registerDoctorWebPush,
} from "@/lib/push/client";
import { triggerQueueAlert } from "@/lib/queue/audio-alerts";
import { formatNameForSpeech } from "@/lib/queue/arabic-speech-text";
import { useLanguage } from "@/contexts/LanguageContext";

const DISMISS_KEY = "mcp-doctor-alerts-banner-dismissed";

function alertsEnabled(): boolean {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  return Notification.permission === "granted";
}

export function DoctorAlertsSetup() {
  const { t, bi } = useLanguage();
  const [showBanner, setShowBanner] = useState(false);
  const [activating, setActivating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "granted") {
      void registerDoctorWebPush(false);
      return;
    }
    if (Notification.permission === "denied") return;
    if (localStorage.getItem(DISMISS_KEY) === "1") return;
    setShowBanner(true);
  }, []);

  useEffect(() => {
    return listenForPushAlertMessages((payload) => {
      const name = formatNameForSpeech(payload.patientName?.trim() || t("entityPatient"));
      void triggerQueueAlert({
        kind: "doctor_new",
        title: payload.title ?? t("docNewPatientAlert"),
        message:
          payload.body ??
          `${t("docNewPatientAlertBody")} ${name}`,
        linkPath: payload.url ?? "/doctor/queue",
        patientName: name,
      });
    });
  }, [t]);

  const activate = useCallback(async () => {
    setActivating(true);
    setMessage(null);
    try {
      const granted = await ensureNotificationPermission();
      if (!granted) {
        setMessage(t("docAlertsPermissionDenied"));
        return;
      }

      if (isWebPushSupported()) {
        const ok = await registerDoctorWebPush(false);
        if (!ok) {
          setMessage(t("docAlertsPushFailed"));
          return;
        }
      }

      setShowBanner(false);
      localStorage.removeItem(DISMISS_KEY);
      setMessage(t("docAlertsEnabled"));
      window.setTimeout(() => setMessage(null), 6000);
    } finally {
      setActivating(false);
    }
  }, [t]);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setShowBanner(false);
  }

  if (!showBanner && !message) {
    if (alertsEnabled()) return null;
    return null;
  }

  return (
    <div className="space-y-2">
      {showBanner && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-200 text-violet-800">
              <Bell className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-violet-950">{t("docAlertsTitle")}</p>
              <p className="mt-1 text-xs leading-relaxed text-violet-900/90">
                {t("docAlertsDesc")}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={activating}
                  onClick={() => void activate()}
                  className="touch-target rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white hover:bg-violet-800 disabled:opacity-60"
                >
                  {activating ? t("docActivatingAlerts") : t("docEnableAlerts")}
                </button>
                <button
                  type="button"
                  onClick={dismiss}
                  className="touch-target rounded-xl border border-violet-200 px-4 py-2 text-sm text-violet-800"
                >
                  {t("docLater")}
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={dismiss}
              className="touch-target shrink-0 rounded-lg p-1 text-violet-500 hover:bg-violet-100"
              aria-label={t("close")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {message && (
        <p className="rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {message}
        </p>
      )}
    </div>
  );
}
