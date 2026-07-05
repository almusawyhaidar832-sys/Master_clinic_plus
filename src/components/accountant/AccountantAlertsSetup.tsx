"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Volume2, Bell, X } from "lucide-react";
import { ensureNotificationPermission } from "@/lib/queue/realtime-client";
import {
  getNotificationPermissionKey,
  refreshNotificationPermission,
  subscribeNotificationPermission,
} from "@/lib/pwa/notification-permission";
import {
  fetchPushSubscriptionStatus,
  isWebPushSupported,
  registerAccountantWebPush,
} from "@/lib/push/client";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import {
  hasPersistedAudioConsent,
  isQueueAudioReady,
  triggerQueueAlert,
  unlockQueueAudio,
} from "@/lib/queue/audio-alerts";
import { hasPersistedSpeechUnlock } from "@/lib/queue/web-speech";
import {
  getNotificationSettingsHintAr,
  getNotificationSettingsHintEn,
} from "@/lib/pwa/platform";
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
 * يعمل على أي صفحة في لوحة المحاسب (Realtime + Push).
 */
export function AccountantAlertsSetup({
  showTestControls = false,
}: AccountantAlertsSetupProps) {
  const { t, bi } = useLanguage();

  const permissionKey = useSyncExternalStore(
    subscribeNotificationPermission,
    getNotificationPermissionKey,
    () => "unsupported" as const
  );
  const browserGranted = permissionKey === "granted";

  const [bannerDismissed, setBannerDismissed] = useState(readDismissed);
  const [activating, setActivating] = useState(false);
  const [testingPush, setTestingPush] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const [pushReady, setPushReady] = useState(false);
  const [pushRegistering, setPushRegistering] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const pushInflightRef = useRef(false);
  const lastPushSyncRef = useRef(0);
  const PUSH_SYNC_COOLDOWN_MS = 60_000;

  const alertsFullyActive = voiceReady && (browserGranted || pushReady);

  const refreshVoiceReady = useCallback(() => {
    setVoiceReady(hasVoiceConsent() || isQueueAudioReady());
  }, []);

  const registerPush = useCallback(
    (opts?: { force?: boolean; requestPermission?: boolean }) => {
      if (!isWebPushSupported() || pushInflightRef.current) {
        return Promise.resolve(false);
      }
      if (!browserGranted && !opts?.requestPermission) {
        return Promise.resolve(false);
      }

      pushInflightRef.current = true;
      setPushRegistering(true);
      return registerAccountantWebPush(opts?.requestPermission === true, {
        forceResubscribe: opts?.force === true,
      })
        .then(async (result) => {
          const status = result.ok
            ? await fetchPushSubscriptionStatus("accountant")
            : null;
          const serverReady = (status?.subscriptionCount ?? 0) > 0;
          const ready = result.ok && serverReady;
          setPushReady(ready);
          if (!result.ok) {
            console.warn("[accountant-alerts] push failed:", result.reason);
          }
          return ready;
        })
        .finally(() => {
          pushInflightRef.current = false;
          setPushRegistering(false);
        });
    },
    [browserGranted]
  );

  const syncPushStatus = useCallback(async (): Promise<boolean> => {
    if (!browserGranted) {
      setPushReady(false);
      return false;
    }
    const status = await fetchPushSubscriptionStatus("accountant");
    const ready = (status?.subscriptionCount ?? 0) > 0;
    setPushReady(ready);
    if (status?.tableMissing) {
      setMessage(t("accPushTableMissing"));
      setMessageIsError(true);
    }
    return ready;
  }, [browserGranted, t]);

  useEffect(() => {
    refreshVoiceReady();
  }, [refreshVoiceReady]);

  useEffect(() => {
    if (!browserGranted) return;
    void syncPushStatus().then((ready) => {
      if (!ready) void registerPush({ force: false });
    });
  }, [browserGranted, registerPush, syncPushStatus]);

  useEffect(() => {
    if (!browserGranted) return;

    const refreshPush = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastPushSyncRef.current < PUSH_SYNC_COOLDOWN_MS) return;
      lastPushSyncRef.current = now;

      void syncPushStatus().then((ready) => {
        if (!ready && !pushInflightRef.current) {
          void registerPush({ force: false });
        }
      });
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") refreshPush();
    };

    onVisible();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [browserGranted, registerPush, syncPushStatus]);

  const activate = useCallback(async () => {
    setActivating(true);
    setMessage(null);
    setMessageIsError(false);
    try {
      const audioOk = await unlockQueueAudio();
      refreshVoiceReady();

      let snap = await refreshNotificationPermission();
      let granted = snap.granted || (await ensureNotificationPermission());

      if (!granted) {
        snap = await refreshNotificationPermission();
        granted = snap.granted;
      }

      if (!granted && snap.permission === "denied") {
        setMessage(
          `${t("accNotifyDenied")} — ${bi(
            getNotificationSettingsHintAr(),
            getNotificationSettingsHintEn()
          )}`
        );
        setMessageIsError(true);
      }

      if (granted && isWebPushSupported()) {
        await registerPush({ force: true, requestPermission: true });
      }

      const ready = audioOk || hasVoiceConsent();
      setVoiceReady(ready);

      if (ready) {
        try {
          localStorage.removeItem(DISMISS_KEY);
        } catch {
          // ignore
        }
        setBannerDismissed(true);
        setMessage(t("accVoiceEnabled"));
        setMessageIsError(false);
        window.setTimeout(() => setMessage(null), 6000);
      } else {
        setMessage(t("accVoiceRetry"));
        setMessageIsError(true);
      }
    } finally {
      setActivating(false);
    }
  }, [bi, refreshVoiceReady, registerPush, t]);

  const testAlert = useCallback(async () => {
    await unlockQueueAudio();
    refreshVoiceReady();
    void triggerQueueAlert({
      kind: "accountant_admit",
      title: t("accAdmitAlertTitle"),
      message: `${bi("المراجع أحمد", "Patient Ahmad")} — ${t("accAdmitAlertBody")}`,
      linkPath: "/dashboard/queue",
      patientName: bi("أحمد", "Ahmad"),
    });
  }, [bi, refreshVoiceReady, t]);

  const testServerPush = useCallback(async () => {
    if (!pushReady) return;
    setTestingPush(true);
    setMessage(null);
    setMessageIsError(false);
    try {
      const res = await fetch("/api/push/test", {
        method: "POST",
        credentials: "include",
        headers: authPortalHeaders("accountant"),
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        sent?: number;
        configured?: boolean;
      };
      if (!res.ok || !json.success) {
        setMessage(
          json.configured === false
            ? t("accPushVapidMissing")
            : t("accPushTestFailed")
        );
        setMessageIsError(true);
        return;
      }
      setMessage(t("accPushTestSent"));
      setMessageIsError(false);
      window.setTimeout(() => setMessage(null), 10000);
    } finally {
      setTestingPush(false);
    }
  }, [pushReady, t]);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
    setBannerDismissed(true);
  }

  const showTopBanner = !voiceReady && !bannerDismissed;
  const showFloatingBar = !voiceReady;

  return (
    <>
      <div className="space-y-2">
        {showTopBanner && (
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

        {voiceReady && browserGranted && !pushReady && isWebPushSupported() && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/90 px-3 py-2">
            <p className="text-xs font-medium text-amber-950">
              {t("accPushPendingHint")}
            </p>
            <button
              type="button"
              disabled={pushRegistering}
              onClick={() => void registerPush({ force: true, requestPermission: true })}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm disabled:opacity-60"
            >
              <Bell className="h-3.5 w-3.5" />
              {pushRegistering ? t("docActivatingAlerts") : t("accEnableBackgroundPush")}
            </button>
          </div>
        )}

        {showTestControls && voiceReady && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-bold text-slate-800">
              {t("accVoiceSettingsTitle")}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              {alertsFullyActive ? t("accVoiceActive") : t("accVoicePartial")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void testAlert()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-900"
              >
                <Volume2 className="h-3.5 w-3.5" />
                {t("accTestVoice")}
              </button>
              {pushReady && (
                <button
                  type="button"
                  disabled={testingPush}
                  onClick={() => void testServerPush()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                >
                  <Bell className="h-3.5 w-3.5" />
                  {testingPush ? t("docActivatingAlerts") : t("accTestPush")}
                </button>
              )}
            </div>
          </div>
        )}

        {message && (
          <p
            className={
              messageIsError
                ? "rounded-xl bg-red-50 px-4 py-2 text-sm text-red-800"
                : "rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-800"
            }
          >
            {message}
          </p>
        )}
      </div>

      {showFloatingBar && (
        <div
          role="alert"
          className="fixed inset-x-3 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] z-[110] mx-auto flex max-w-lg items-center gap-3 rounded-2xl border border-emerald-300 bg-emerald-900 px-4 py-3 text-white shadow-2xl"
        >
          <Volume2 className="h-6 w-6 shrink-0 text-emerald-200" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold leading-snug">{t("accFloatingTitle")}</p>
            <p className="mt-0.5 text-xs text-emerald-100/90">{t("accFloatingDesc")}</p>
          </div>
          <button
            type="button"
            disabled={activating}
            onClick={() => void activate()}
            className="shrink-0 rounded-xl bg-white px-4 py-2 text-sm font-bold text-emerald-900 hover:bg-emerald-50 disabled:opacity-60"
          >
            {activating ? "…" : t("accEnableVoice")}
          </button>
        </div>
      )}
    </>
  );
}
