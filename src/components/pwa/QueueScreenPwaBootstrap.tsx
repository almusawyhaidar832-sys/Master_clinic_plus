"use client";

import { useEffect } from "react";

const SW_URL = "/sw.js";
const SW_UPDATE_CHECK_MS = 60_000;

/** يثبّت manifest + service worker + وضع التلفاز على شاشة الانتظار */
export function QueueScreenPwaBootstrap() {
  useEffect(() => {
    document.documentElement.classList.add("qs-tv-mode");
    return () => {
      document.documentElement.classList.remove("qs-tv-mode");
    };
  }, []);

  useEffect(() => {
    const href = "/manifest-queue-screen.json";
    let link = document.querySelector<HTMLLinkElement>(
      'link[rel="manifest"][href="/manifest-queue-screen.json"]'
    );

    if (!link) {
      link = document.createElement("link");
      link.rel = "manifest";
      link.href = href;
      document.head.appendChild(link);
    }

    document.querySelectorAll('link[rel="manifest"]').forEach((el) => {
      if (el !== link && el.getAttribute("href") !== href) {
        el.remove();
      }
    });

    const theme = document.querySelector('meta[name="theme-color"]');
    if (theme) theme.setAttribute("content", "#0891b2");
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let reloaded = false;
    let updateInterval: ReturnType<typeof setInterval> | undefined;

    /** يعيد تحميل الشاشة فور تفعّل نسخة Service Worker جديدة — التلفاز
     * يبقى مفتوحاً لأيام بلا تدخل بشري فيجب أن يلتقط النشر الجديد لوحده. */
    const reloadOnce = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", reloadOnce);

    void navigator.serviceWorker
      .register(SW_URL, { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        void registration.update().catch(() => {});
        /** المتصفحات تتباطأ بفحص تحديثات Service Worker تلقائياً على
         * تبويب مفتوح طويلاً — نفرض الفحص يدوياً بشكل دوري. */
        updateInterval = setInterval(() => {
          void registration.update().catch(() => {});
        }, SW_UPDATE_CHECK_MS);
      })
      .catch(() => {
        /* بعض متصفحات التلفاز القديمة لا تدعم SW */
      });

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", reloadOnce);
      if (updateInterval) clearInterval(updateInterval);
    };
  }, []);

  return null;
}
