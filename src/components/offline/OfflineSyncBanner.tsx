"use client";

import { useCallback, useEffect, useState } from "react";
import { CloudUpload, Loader2 } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { countPendingOfflineQueue } from "@/lib/offline/queue-store";
import { OFFLINE_QUEUE_CHANGED_EVENT } from "@/lib/offline/types";
import { isBrowserOffline } from "@/lib/offline/network";
import { runOfflineSync } from "@/lib/offline/sync/runner";

export function OfflineSyncBanner() {
  const { t } = useLanguage();
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const refreshPending = useCallback(async () => {
    try {
      const count = await countPendingOfflineQueue();
      setPending(count);
    } catch {
      setPending(0);
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (isBrowserOffline() || syncing) return;
    setSyncing(true);
    setLastResult(null);
    try {
      const result = await runOfflineSync();
      await refreshPending();
      if (result.synced > 0) {
        setLastResult(
          t("offlineSyncDone").replace("{n}", String(result.synced))
        );
      } else if (result.failed > 0) {
        setLastResult(t("offlineSyncPartialFail"));
      }
    } finally {
      setSyncing(false);
    }
  }, [refreshPending, syncing, t]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onOnline = () => {
      void syncNow();
    };

    const onVisible = () => {
      if (document.visibilityState === "visible" && !isBrowserOffline()) {
        void syncNow();
      }
    };

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    void refreshPending();

    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshPending, syncNow]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    window.addEventListener(OFFLINE_QUEUE_CHANGED_EVENT, () => {
      void refreshPending();
    });

    void refreshPending();
  }, [refreshPending]);

  if (pending === 0 && !lastResult && !syncing) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="safe-top fixed left-3 right-3 top-14 z-[99]"
    >
      <div className="flex items-start gap-2 rounded-xl border border-sky-300/80 bg-sky-50 px-3 py-2.5 text-sm text-sky-950 shadow-lg">
          {syncing ? (
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden />
          ) : (
            <CloudUpload className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          )}
          <div className="flex-1 leading-snug">
            {syncing
              ? t("offlineSyncing")
              : pending > 0
                ? t("offlinePendingCount").replace("{n}", String(pending))
                : lastResult}
          </div>
          {!isBrowserOffline() && pending > 0 && !syncing && (
            <button
              type="button"
              onClick={() => void syncNow()}
              className="shrink-0 rounded-md bg-sky-700 px-2 py-1 text-xs text-white hover:bg-sky-800"
            >
              {t("offlineSyncNow")}
            </button>
          )}
        </div>
    </div>
  );
}
