"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Volume2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  installQueueAudioUnlock,
  isQueueAudioReady,
  subscribeQueueAlerts,
  unlockQueueAudio,
  type QueueAlertDetail,
} from "@/lib/queue/audio-alerts";

/**
 * On-screen alert banner + audio unlock prompt.
 * Mount once per portal layout alongside QueueRealtimeBridge.
 */
export function QueueAlertOverlay() {
  const [alert, setAlert] = useState<QueueAlertDetail | null>(null);
  const [audioReady, setAudioReady] = useState(false);

  useEffect(() => {
    setAudioReady(isQueueAudioReady());
    const removeUnlock = installQueueAudioUnlock();

    const interval = setInterval(() => {
      if (isQueueAudioReady()) setAudioReady(true);
    }, 2000);

    const unsub = subscribeQueueAlerts((detail) => {
      setAlert(detail);
    });

    return () => {
      removeUnlock();
      clearInterval(interval);
      unsub();
    };
  }, []);

  useEffect(() => {
    if (!alert) return;
    const timer = setTimeout(() => setAlert(null), 12000);
    return () => clearTimeout(timer);
  }, [alert]);

  async function enableAudio() {
    const ok = await unlockQueueAudio();
    setAudioReady(ok);
  }

  return (
    <>
      {!audioReady && (
        <button
          type="button"
          onClick={() => void enableAudio()}
          className="fixed bottom-24 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-full bg-amber-500 px-5 py-3 text-sm font-bold text-white shadow-lg animate-pulse hover:bg-amber-600"
        >
          <Volume2 className="h-5 w-5" />
          اضغط لتفعيل التنبيهات الصوتية
        </button>
      )}

      {alert && (
        <div
          role="alert"
          className={cn(
            "fixed left-4 right-4 top-20 z-[100] mx-auto max-w-lg rounded-2xl border-2 p-4 shadow-2xl",
            alert.kind === "doctor_new"
              ? "border-violet-300 bg-violet-50 text-violet-950"
              : "border-emerald-300 bg-emerald-50 text-emerald-950"
          )}
        >
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl",
                alert.kind === "doctor_new"
                  ? "bg-violet-200 text-violet-700"
                  : "bg-emerald-200 text-emerald-700"
              )}
            >
              {alert.kind === "doctor_new" ? (
                <Bell className="h-6 w-6" />
              ) : (
                <BellOff className="h-6 w-6" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold">{alert.title}</p>
              <p className="mt-1 text-sm leading-relaxed">{alert.message}</p>
            </div>
            <button
              type="button"
              onClick={() => setAlert(null)}
              className="rounded-lg p-1 opacity-60 hover:opacity-100"
              aria-label="إغلاق"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
