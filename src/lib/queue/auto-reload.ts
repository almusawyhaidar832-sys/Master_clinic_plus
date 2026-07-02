"use client";

import { useEffect, useRef } from "react";

const VERSION_URL = "/api/queue/screen/version";
const POLL_MS = 90_000;
const CURRENT_BUILD_ID = process.env.NEXT_PUBLIC_APP_BUILD_ID ?? "";

/**
 * شاشة الانتظار تبقى مفتوحة على التلفاز لأيام/أسابيع بدون أي تدخل بشري —
 * فبدون آلية تحديث تلقائي، يبقى التلفاز عالقاً على كود قديم للأبد بعد كل
 * نشر جديد على Vercel (وهذا سبب ظهور تصميم/تخطيط قديم مختلط مع تحديثات
 * جزئية). هذا الـ hook يقارن دورياً نسخة الجافاسكربت المحمَّلة حالياً مع
 * النسخة الحيّة على السيرفر، ويعيد تحميل الصفحة تلقائياً عند اختلافهما —
 * فقط أثناء عدم وجود نداء نشط حتى لا يقاطع إعلاناً صوتياً جارياً.
 */
export function useAutoReloadOnNewDeploy(isIdle: boolean): void {
  const pendingReloadRef = useRef(false);
  const isIdleRef = useRef(isIdle);
  isIdleRef.current = isIdle;

  useEffect(() => {
    if (typeof window === "undefined" || !CURRENT_BUILD_ID) return;

    let cancelled = false;

    const applyReloadIfIdle = () => {
      if (!pendingReloadRef.current || cancelled) return;
      if (!isIdleRef.current) return;
      window.location.reload();
    };

    const checkVersion = async () => {
      try {
        const res = await fetch(VERSION_URL, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { buildId?: string };
        if (
          data.buildId &&
          data.buildId !== CURRENT_BUILD_ID &&
          !pendingReloadRef.current
        ) {
          pendingReloadRef.current = true;
        }
        applyReloadIfIdle();
      } catch {
        // أوفلاين أو خطأ شبكة — نعيد المحاولة بالدورة القادمة
      }
    };

    const poll = setInterval(() => {
      void checkVersion();
    }, POLL_MS);

    const idleCheck = setInterval(applyReloadIfIdle, 5_000);

    void checkVersion();

    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(idleCheck);
    };
  }, []);
}
