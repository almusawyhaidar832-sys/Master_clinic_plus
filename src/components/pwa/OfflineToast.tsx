"use client";

import { useEffect, useState } from "react";
import { WifiOff, X } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

export function OfflineToast() {
  const { t } = useLanguage();
  const [offline, setOffline] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const sync = () => {
      const next = !navigator.onLine;
      setOffline(next);
      if (next) setDismissed(false);
    };

    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!offline || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="safe-top fixed left-3 right-3 top-3 z-[100] flex items-start gap-2 rounded-xl border border-amber-300/80 bg-amber-50 px-3 py-2.5 text-sm text-amber-950 shadow-lg"
    >
      <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
      <p className="flex-1 leading-snug">{t("offlineModeHint")}</p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded-md p-1 text-amber-800 hover:bg-amber-100"
        aria-label={t("close")}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
