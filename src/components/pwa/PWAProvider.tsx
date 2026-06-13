"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

import { isAndroid, isIOS, isStandalonePwa } from "@/lib/pwa/platform";

const DISMISS_KEY = "mcp-pwa-install-dismissed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function PWAProvider() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [showBanner, setShowBanner] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);

  const [showAndroidHint, setShowAndroidHint] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        /* optional */
      });
    }
  }, []);

  useEffect(() => {
    if (isStandalonePwa()) return;
    if (localStorage.getItem(DISMISS_KEY) === "1") return;

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setShowBanner(true);
    };

    window.addEventListener("beforeinstallprompt", onBip);

    if (isIOS()) {
      const t = window.setTimeout(() => setShowIosHint(true), 2500);
      return () => {
        window.removeEventListener("beforeinstallprompt", onBip);
        window.clearTimeout(t);
      };
    }

    if (isAndroid()) {
      const t = window.setTimeout(() => setShowAndroidHint(true), 2500);
      return () => {
        window.removeEventListener("beforeinstallprompt", onBip);
        window.clearTimeout(t);
      };
    }

    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setShowBanner(false);
    setShowIosHint(false);
    setShowAndroidHint(false);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    setShowBanner(false);
  }

  if (isStandalonePwa()) return null;

  if (showBanner && deferred) {
    return (
      <div
        role="dialog"
        aria-label="تثبيت التطبيق"
        className="safe-bottom fixed bottom-0 left-0 right-0 z-[100] border-t border-teal-200 bg-white p-4 shadow-[0_-8px_30px_rgba(0,0,0,0.12)] md:bottom-4 md:left-auto md:right-4 md:max-w-sm md:rounded-2xl md:border"
      >
        <div className="mx-auto flex max-w-lg items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-teal-600 text-lg font-bold text-white">
            M+
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-slate-800">أضف ماستر كلينك بلس للشاشة الرئيسية</p>
            <p className="mt-0.5 text-xs text-slate-500">
              يعمل كتطبيق أصلي — دخول سريع من أيقونة واحدة
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void install()}
                className="touch-target inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 text-sm font-bold text-white hover:bg-teal-500"
              >
                <Download className="h-4 w-4" />
                تثبيت
              </button>
              <button
                type="button"
                onClick={dismiss}
                className="touch-target rounded-xl border border-slate-200 px-4 text-sm text-slate-600"
              >
                لاحقاً
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="touch-target shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
    );
  }

  if (showAndroidHint && !showBanner) {
    return (
      <div className="safe-bottom fixed bottom-0 left-0 right-0 z-[100] border-t border-slate-200 bg-slate-900/95 p-4 text-white backdrop-blur md:bottom-4 md:left-auto md:right-4 md:max-w-sm md:rounded-2xl">
        <div className="mx-auto flex max-w-lg items-start gap-3">
          <Download className="mt-1 h-5 w-5 shrink-0 text-teal-400" />
          <div className="flex-1 text-sm">
            <p className="font-bold">تثبيت تطبيق الطبيب (Android)</p>
            <p className="mt-1 text-xs text-slate-300">
              من Chrome: ⋮ → <strong className="text-white">Install app</strong> أو{" "}
              <strong className="text-white">Add to Home screen</strong> — لا تستخدم
              «اختصار» فقط، لازم «Install app» حتى يفتح بدون شريط Chrome
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="touch-target rounded-lg p-2 text-slate-400"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
    );
  }

  if (showIosHint) {
    return (
      <div className="safe-bottom fixed bottom-0 left-0 right-0 z-[100] border-t border-slate-200 bg-slate-900/95 p-4 text-white backdrop-blur md:bottom-4 md:left-auto md:right-4 md:max-w-sm md:rounded-2xl">
        <div className="mx-auto flex max-w-lg items-start gap-3">
          <Share className="mt-1 h-5 w-5 shrink-0 text-teal-400" />
          <div className="flex-1 text-sm">
            <p className="font-bold">إضافة إلى الشاشة الرئيسية (iPhone)</p>
            <p className="mt-1 text-xs text-slate-300">
              من Safari: زر المشاركة ↗ ثم «Add to Home Screen»
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="touch-target rounded-lg p-2 text-slate-400"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
    );
  }

  return null;
}
