"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Monitor, CheckCircle2 } from "lucide-react";
import {
  detectTvPlatform,
  getQueueScreenInstallSteps,
  isQueueScreenInstalled,
} from "@/lib/pwa/tv-platform";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface QueueScreenPwaInstallProps {
  /** compact = شريط صغير في الشاشة الرئيسية */
  variant?: "card" | "compact";
  onInstalled?: () => void;
}

export function QueueScreenPwaInstall({
  variant = "card",
  onInstalled,
}: QueueScreenPwaInstallProps) {
  const [installed, setInstalled] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState(false);
  const [platform] = useState(() => detectTvPlatform());
  const steps = getQueueScreenInstallSteps(platform);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setInstalled(isQueueScreenInstalled());

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setInstalled(true);
      setDeferred(null);
      onInstalled?.();
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, [onInstalled]);

  const handleInstall = useCallback(async () => {
    if (!deferred) return;
    setInstalling(true);
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === "accepted") {
        setInstalled(true);
        setDeferred(null);
        onInstalled?.();
      }
    } finally {
      setInstalling(false);
    }
  }, [deferred, onInstalled]);

  if (installed) {
    if (variant === "compact") return null;
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <CheckCircle2 className="h-5 w-5 shrink-0" />
        <span className="font-semibold">مثبّتة كتطبيق على هذا التلفاز</span>
      </div>
    );
  }

  if (variant === "compact") {
    return (
      <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500">
        <Monitor className="h-3.5 w-3.5" />
        <span>لتثبيت كتطبيق:</span>
        {deferred ? (
          <button
            type="button"
            onClick={() => void handleInstall()}
            disabled={installing}
            className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-3 py-1 font-bold text-white hover:bg-teal-700 disabled:opacity-50"
          >
            <Download className="h-3 w-3" />
            {installing ? "جاري التثبيت..." : "تثبيت التطبيق"}
          </button>
        ) : (
          <span className="font-medium text-teal-700">Chrome ⋮ → تثبيت التطبيق</span>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-right text-xs text-slate-600">
      <p className="mb-2 flex items-center gap-2 font-bold text-slate-800">
        <Monitor className="h-4 w-4 text-teal-600" />
        تثبيت شاشة الانتظار كتطبيق على التلفاز
      </p>

      {deferred && (
        <button
          type="button"
          onClick={() => void handleInstall()}
          disabled={installing}
          className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-cyan-600 to-teal-600 px-4 py-3 text-sm font-bold text-white shadow-md hover:opacity-95 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          {installing ? "جاري التثبيت..." : "تثبيت التطبيق الآن"}
        </button>
      )}

      <ol className="list-decimal space-y-1.5 pr-5 leading-relaxed">
        {steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>

      {!deferred && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          إذا لم يظهر زر التثبيت: استخدم قائمة المتصفح ⋮ يدوياً — «Add to Home screen» أو
          «Install app».
        </p>
      )}
    </div>
  );
}
