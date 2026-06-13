"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Bell, Share, Smartphone, Volume2, X } from "lucide-react";
import { PwaInstallButton } from "@/components/pwa/PwaInstallButton";
import { ensureNotificationPermission } from "@/lib/queue/realtime-client";
import {
  getNotificationPermissionKey,
  refreshNotificationPermission,
  subscribeNotificationPermission,
} from "@/lib/pwa/notification-permission";
import {
  isWebPushSupported,
  listenForServiceWorkerNavigation,
  registerDoctorWebPush,
  fetchPushSubscriptionStatus,
} from "@/lib/push/client";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { triggerQueueAlert, unlockQueueAudio } from "@/lib/queue/audio-alerts";
import { warmDoctorCloudTts } from "@/lib/queue/cloud-speech";
import {
  backgroundPushNeedsInstalledApp,
  getDoctorPushCapability,
  getNotificationSettingsHintAr,
  getNotificationSettingsHintEn,
  getPwaInstallHintAr,
  getPwaInstallHintEn,
  isAndroid,
  isIOS,
  isStandalonePwa,
} from "@/lib/pwa/platform";
import { useLanguage } from "@/contexts/LanguageContext";

const DISMISS_KEY = "mcp-doctor-alerts-banner-dismissed";

function readDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function DoctorAlertsSetup() {
  const { t, bi } = useLanguage();
  const router = useRouter();

  /** مصدر الحقيقة — حالة المتصفح الفعلية */
  const permissionKey = useSyncExternalStore(
    subscribeNotificationPermission,
    getNotificationPermissionKey,
    () => "unsupported" as const
  );
  const browserGranted = permissionKey === "granted";

  const [bannerDismissed, setBannerDismissed] = useState(readDismissed);
  const [activating, setActivating] = useState(false);
  const [testingPush, setTestingPush] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [pushReady, setPushReady] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "android" | "other">("other");
  const [pushRegistering, setPushRegistering] = useState(false);
  const [needsInstallForBackground, setNeedsInstallForBackground] = useState(false);
  const pushInflightRef = useRef(false);
  const lastPushSyncRef = useRef(0);
  const PUSH_SYNC_COOLDOWN_MS = 60_000;

  const showActivationBanner =
    !browserGranted &&
    permissionKey !== "denied" &&
    !bannerDismissed;

  const alertsActive = browserGranted;

  const registerPush = useCallback(
    (opts?: { force?: boolean; requestPermission?: boolean }) => {
      if (!browserGranted || !isWebPushSupported() || pushInflightRef.current) {
        return Promise.resolve(false);
      }
      pushInflightRef.current = true;
      setPushRegistering(true);
      return registerDoctorWebPush(opts?.requestPermission === true, {
        forceResubscribe: opts?.force === true,
      })
        .then(async (result) => {
          const status = result.ok
            ? await fetchPushSubscriptionStatus()
            : null;
          const serverReady = (status?.subscriptionCount ?? 0) > 0;
          const ready = result.ok && serverReady;
          setPushReady(ready);
          if (!result.ok) {
            console.warn("[doctor-alerts] push registration failed:", result.reason);
            if (result.reason === "server-not-saved" || result.reason === "server-failed") {
              setMessage(t("docAlertsPushServerMissing"));
              setMessageIsError(true);
            }
          } else if (!serverReady) {
            setMessage(t("docAlertsPushServerMissing"));
            setMessageIsError(true);
          }
          return ready;
        })
        .finally(() => {
          pushInflightRef.current = false;
          setPushRegistering(false);
        });
    },
    [browserGranted, t]
  );

  const syncPushStatus = useCallback(async (): Promise<boolean> => {
    if (!browserGranted) {
      setPushReady(false);
      return false;
    }
    const status = await fetchPushSubscriptionStatus();
    const ready = (status?.subscriptionCount ?? 0) > 0;
    setPushReady(ready);
    if (status?.tableMissing) {
      setMessage(t("docAlertsPushTableMissing"));
      setMessageIsError(true);
    }
    return ready;
  }, [browserGranted, t]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const installed = isStandalonePwa();
    setStandalone(installed);
    setNeedsInstallForBackground(backgroundPushNeedsInstalledApp());
    if (isIOS()) setPlatform("ios");
    else if (isAndroid()) setPlatform("android");
  }, []);

  useEffect(() => {
    if (!browserGranted) return;
    setMessage(null);
    setMessageIsError(false);
    setBannerDismissed(false);
    try {
      localStorage.removeItem(DISMISS_KEY);
    } catch {
      // ignore
    }
    void warmDoctorCloudTts();
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
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [browserGranted, registerPush, syncPushStatus]);

  useEffect(() => {
    return listenForServiceWorkerNavigation((url) => {
      router.push(url);
    });
  }, [router]);

  const activate = useCallback(async () => {
    setActivating(true);
    setMessage(null);
    setMessageIsError(false);
    try {
      await unlockQueueAudio();

      if (typeof window !== "undefined" && Notification.permission === "granted") {
        setBannerDismissed(true);
        const ready = await registerPush({ force: true, requestPermission: true });
        setMessage(ready ? t("docAlertsEnabled") : t("docAlertsPushServerMissing"));
        setMessageIsError(!ready);
        window.setTimeout(() => setMessage(null), 8000);
        return;
      }

      let snap = await refreshNotificationPermission();
      let granted = snap.granted || (await ensureNotificationPermission());

      if (!granted) {
        snap = await refreshNotificationPermission();
        granted = snap.granted;
      }

      if (!granted) {
        if (!snap.supported && isIOS() && !isStandalonePwa()) {
          setBannerDismissed(true);
          setMessage(t("docAlertsInAppOnly"));
          setMessageIsError(false);
          window.setTimeout(() => setMessage(null), 8000);
          void warmDoctorCloudTts();
          return;
        }
        setMessage(
          snap.permission === "denied"
            ? `${t("docAlertsPermissionDenied")} — ${bi(
                getNotificationSettingsHintAr(),
                getNotificationSettingsHintEn()
              )} ${t("docAlertsReopenHint")}`
            : t("docAlertsPermissionRetry")
        );
        setMessageIsError(true);
        return;
      }

      setBannerDismissed(true);
      try {
        localStorage.removeItem(DISMISS_KEY);
      } catch {
        // ignore
      }

      const capability = getDoctorPushCapability();
      if (capability.level === "in-app-only") {
        setMessage(t("docAlertsInAppOnly"));
        setMessageIsError(false);
        window.setTimeout(() => setMessage(null), 8000);
        return;
      }

      setMessage(t("docAlertsEnabled"));
      setMessageIsError(false);
      window.setTimeout(() => setMessage(null), 6000);
      const ready = await registerPush({ force: true, requestPermission: true });
      if (!ready) {
        setMessage(t("docAlertsPushServerMissing"));
        setMessageIsError(true);
      }
    } finally {
      setActivating(false);
    }
  }, [bi, registerPush, t]);

  const testAlert = useCallback(async () => {
    await unlockQueueAudio();
    await warmDoctorCloudTts();
    void triggerQueueAlert({
      kind: "doctor_new",
      title: bi("تجربة النداء 🔔", "Test alert 🔔"),
      message: bi(
        "هكذا يسمع الطبيب عند وصول مراجع — تأكد من رفع الصوت",
        "This is how alerts sound when a patient arrives — check your volume"
      ),
      linkPath: "/doctor/queue",
      patientName: bi("مراجع", "Patient"),
    });
  }, [bi]);

  const testServerPush = useCallback(async () => {
    if (!pushReady) return;
    setTestingPush(true);
    setMessage(null);
    setMessageIsError(false);
    try {
      const res = await fetch("/api/push/test", {
        method: "POST",
        credentials: "include",
        headers: authPortalHeaders("doctor"),
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        sent?: number;
        configured?: boolean;
      };
      if (!res.ok || !json.success) {
        setMessage(
          json.configured === false
            ? t("docAlertsPushVapidMissing")
            : t("docAlertsPushFailed")
        );
        setMessageIsError(true);
        return;
      }
      setMessage(t("docAlertsPushTestSentCloseApp"));
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

  const iosNeedsInstall = platform === "ios" && !standalone;
  const androidHint = platform === "android" && !standalone;
  const androidBackgroundBlocked = needsInstallForBackground && browserGranted;

  return (
    <div className="space-y-2">
      {androidBackgroundBlocked && (
        <div className="rounded-2xl border border-red-300 bg-red-50 p-3">
          <div className="flex items-start gap-2">
            <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-xs font-bold leading-relaxed text-red-950">
                {t("docAlertsAndroidBackgroundTitle")}
              </p>
              <p className="text-xs leading-relaxed text-red-900">
                {t("docAlertsAndroidBackgroundDesc")}{" "}
                {bi(getPwaInstallHintAr(), getPwaInstallHintEn())}
              </p>
              <PwaInstallButton
                label={t("docInstallApp")}
                installingLabel={t("docInstallingApp")}
                className="touch-target inline-flex items-center gap-1.5 rounded-lg bg-red-700 px-4 py-2 text-xs font-bold text-white shadow-sm disabled:opacity-60"
                onInstalled={() => {
                  setStandalone(true);
                  setNeedsInstallForBackground(false);
                  void registerPush({ force: true });
                }}
              />
            </div>
          </div>
        </div>
      )}

      {iosNeedsInstall && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-start gap-2">
            <Share className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <div className="min-w-0 text-xs leading-relaxed text-amber-950">
              <p className="font-bold">{t("docAlertsIosInstallTitle")}</p>
              <p className="mt-1">{t("docAlertsIosInstallSteps")}</p>
            </div>
          </div>
        </div>
      )}

      {androidHint && !androidBackgroundBlocked && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3">
          <div className="flex items-start gap-2">
            <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-xs leading-relaxed text-sky-950">
                {t("docAlertsAndroidHint")}{" "}
                {bi(getPwaInstallHintAr(), getPwaInstallHintEn())}
              </p>
              <PwaInstallButton
                label={t("docInstallApp")}
                installingLabel={t("docInstallingApp")}
                className="touch-target inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-4 py-2 text-xs font-bold text-white shadow-sm disabled:opacity-60"
                onInstalled={() => setStandalone(true)}
              />
            </div>
          </div>
        </div>
      )}

      {showActivationBanner && (
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

      {alertsActive && !pushReady && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-3 py-2 text-xs leading-relaxed text-amber-950">
          {t("docAlertsPushPendingHint")}
        </div>
      )}

      {alertsActive && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-2">
          <p className="text-xs font-medium text-emerald-900">
            {pushReady
              ? t("docAlertsActive")
              : platform === "android"
                ? t("docAlertsAndroidPushPending")
                : t("docAlertsInAppActive")}
          </p>
          <div className="flex flex-wrap gap-2">
            {!pushReady && isWebPushSupported() && (
              <button
                type="button"
                disabled={pushRegistering}
                onClick={() => void registerPush({ force: true })}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm disabled:opacity-60"
              >
                <Bell className="h-3.5 w-3.5" />
                {pushRegistering ? t("docActivatingAlerts") : t("docEnableBackgroundPush")}
              </button>
            )}
            <button
              type="button"
              onClick={() => void testAlert()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-sm"
            >
              <Volume2 className="h-3.5 w-3.5" />
              {t("docTestAlert")}
            </button>
            {pushReady && (
              <button
                type="button"
                disabled={testingPush}
                onClick={() => void testServerPush()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm disabled:opacity-60"
              >
                <Bell className="h-3.5 w-3.5" />
                {testingPush ? t("docActivatingAlerts") : t("docTestPush")}
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
  );
}
