"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  getSession,
  refreshAuthSession,
} from "@/lib/supabase/auth-helpers";
import { getAuthPortalForPath } from "@/lib/auth/portal-access";

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

    async function keepAlive() {
      if (busy || document.visibilityState !== "visible") return;
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

    void keepAlive();

    const onResume = () => {
      if (document.visibilityState === "visible") {
        void keepAlive();
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
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("focus", onResume);
      window.removeEventListener("pageshow", onResume);
      clearInterval(interval);
    };
  }, [pathname]);

  return null;
}
