"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  getSession,
  refreshAuthSession,
} from "@/lib/supabase/auth-helpers";
import { getAuthPortalForPath } from "@/lib/auth/portal-access";

const RESUME_RETRY_MS = [0, 1500, 4000];

/**
 * يحافظ على جلسة الدخول على iOS/Android عند الخروج للتطبيقات الأخرى —
 * يجدّد التوكن عند العودة وكل ~50 دقيقة والتطبيق مفتوح.
 */
export function SessionKeepAlive() {
  const pathname = usePathname();

  useEffect(() => {
    const portal = getAuthPortalForPath(pathname);
    if (!portal) return;

    const supabase = createClient();
    let busy = false;
    const retryTimers: ReturnType<typeof setTimeout>[] = [];

    async function keepAlive() {
      if (busy) return;
      busy = true;
      try {
        const { data } = await getSession(supabase);
        if (data.session) {
          await refreshAuthSession(supabase);
        }
      } catch {
        /* offline أو تعذر التجديد */
      } finally {
        busy = false;
      }
    }

    function scheduleResumeRefresh() {
      retryTimers.forEach(clearTimeout);
      retryTimers.length = 0;
      RESUME_RETRY_MS.forEach((delay) => {
        retryTimers.push(
          setTimeout(() => {
            if (document.visibilityState === "visible") {
              void keepAlive();
            }
          }, delay)
        );
      });
    }

    void keepAlive();

    const onResume = () => {
      if (document.visibilityState === "visible") {
        scheduleResumeRefresh();
      }
    };

    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("focus", onResume);
    window.addEventListener("pageshow", onResume);

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void keepAlive();
      }
    }, 50 * 60 * 1000);

    return () => {
      retryTimers.forEach(clearTimeout);
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("focus", onResume);
      window.removeEventListener("pageshow", onResume);
      clearInterval(interval);
    };
  }, [pathname]);

  return null;
}
