"use client";

import { useCallback, useEffect, useState } from "react";
import { Volume2, X } from "lucide-react";
import { ensureNotificationPermission } from "@/lib/queue/realtime-client";
import {
  registerAccountantWebPush,
} from "@/lib/push/client";
import {
  hasPersistedAudioConsent,
  triggerQueueAlert,
  unlockQueueAudio,
} from "@/lib/queue/audio-alerts";
import { hasPersistedSpeechUnlock } from "@/lib/queue/web-speech";
import { useLanguage } from "@/contexts/LanguageContext";

const DISMISS_KEY = "mcp-accountant-voice-banner-dismissed";

function readDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function hasVoiceConsent(): boolean {
  return hasPersistedAudioConsent() || hasPersistedSpeechUnlock();
}

type AccountantAlertsSetupProps = {
  showTestControls?: boolean;
};

/**
 * تفعيل النداء الصوتي للمحاسب — عند طلب الطبيب دخول مراجع.
 */
export function AccountantAlertsSetup({
  showTestControls = false,
}: AccountantAlertsSetupProps) {
  const { t, bi } = useLanguage();
  const [bannerDismissed, setBannerDismissed] = useState(readDismissed);
  const [activating, setActivating] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setVoiceReady(hasVoiceConsent());
  }, []);

  const showBanner = !voiceReady && !bannerDismissed;

  const activate = useCallback(async () => {
    setActivating(true);
    setMessage(null);
    try {
      const ok = await unlockQueueAudio();
      await ensureNotificationPermission().catch(() => false);
      void registerAccountantWebPush(true).catch(() => undefined);
      setVoiceReady(ok || hasVoiceConsent());
      if (ok) {
        try {
          localStorage.removeItem(DISMISS_KEY);
        } catch {
          // ignore
        }
        setBannerDismissed(true);
        setMessage(t("accVoiceEnabled"));
        window.setTimeout(() => setMessage(null), 6000);
      } else {
        setMessage(t("accVoiceRetry"));
      }
    } finally {
      setActivating(false);
    }
  }, [t]);

  const testAlert = useCallback(async () => {
    await unlockQueueAudio();
    void triggerQueueAlert({
      kind: "accountant_admit",
      title: t("accAdmitAlertTitle"),
      message: `${bi("المراجع أحمد", "Patient Ahmad")} — ${t("accAdmitAlertBody")}`,
      linkPath: "/dashboard/queue",
      patientName: bi("أحمد", "Ahmad"),
    });
  }, [bi, t]);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
    setBannerDismissed(true);
  }

  return (
    <div className="space-y-2">
      {showBanner && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-200 text-emerald-800">
              <Volume2 className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-emerald-950">{t("accVoiceTitle")}</p>
              <p className="mt-1 text-xs leading-relaxed text-emerald-900/90">
                {t("accVoiceDesc")}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={activating}
                  onClick={() => void activate()}
                  className="touch-target rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-60"
                >
                  {activating ? t("docActivatingAlerts") : t("accEnableVoice")}
                </button>
                <button
                  type="button"
                  onClick={dismiss}
                  className="touch-target rounded-xl border border-emerald-200 px-4 py-2 text-sm text-emerald-800"
                >
                  {t("docLater")}
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={dismiss}
              className="touch-target shrink-0 rounded-lg p-1 text-emerald-500 hover:bg-emerald-100"
              aria-label={t("close")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {showTestControls && voiceReady && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-slate-800">{t("accVoiceSettingsTitle")}</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {t("accVoiceActive")}
          </p>
          <button
            type="button"
            onClick={() => void testAlert()}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-900"
          >
            <Volume2 className="h-3.5 w-3.5" />
            {t("accTestVoice")}
          </button>
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
