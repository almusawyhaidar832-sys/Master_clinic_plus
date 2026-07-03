"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getAuthProfile } from "@/lib/clinic-context";
import {
  getSession,
  hasLocalAuthSession,
  onAuthStateChange,
  refreshAuthSession,
  signOutUser,
} from "@/lib/supabase/auth-helpers";
import {
  getAuthPortalForPath,
  isRoleAllowedForPath,
} from "@/lib/auth/portal-access";
import {
  getCachedAuthProfile,
  isBrowserOffline,
} from "@/lib/offline-cache";

/**
 * Client guard: if session role does not match the current portal path,
 * sign out immediately and send user to the correct login card.
 *
 * Performance: after first successful check within a portal, keep the UI visible
 * while re-validating on in-portal navigation (avoids blank flash between pages).
 *
 * PWA: لا يُسجّل الخروج تلقائياً عند الخروج لتطبيق آخر — يعتمد على الجلسة المحلية
 * والملف المخزّن حتى يعود النت أو يضغط المستخدم «تسجيل خروج».
 */
export function PortalAuthGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const sessionOkRef = useRef(false);
  const portalIdRef = useRef<string | null>(null);

  useEffect(() => {
    const resolvedPortal = getAuthPortalForPath(pathname);
    if (!resolvedPortal) {
      sessionOkRef.current = false;
      portalIdRef.current = null;
      setReady(true);
      return;
    }
    const portal = resolvedPortal;

    const supabase = createClient();
    let cancelled = false;

    const samePortalSession =
      sessionOkRef.current && portalIdRef.current === portal.loginPortalId;

    async function acceptCachedProfile(userId: string): Promise<boolean> {
      const cached = getCachedAuthProfile(userId);
      if (!cached || !isRoleAllowedForPath(cached.role, pathname)) {
        return false;
      }
      sessionOkRef.current = true;
      portalIdRef.current = portal.loginPortalId;
      setReady(true);
      return true;
    }

    async function enforce(hideWhileChecking: boolean) {
      if (
        sessionOkRef.current &&
        portalIdRef.current === portal.loginPortalId &&
        (isBrowserOffline() || hideWhileChecking === false)
      ) {
        const hasLocal = await hasLocalAuthSession(supabase);
        if (hasLocal) {
          setReady(true);
          return;
        }
      }

      if (hideWhileChecking && !sessionOkRef.current) {
        setReady(false);
      }

      let profile = await getAuthProfile(supabase);
      if (cancelled) return;

      if (!profile && !isBrowserOffline()) {
        await refreshAuthSession(supabase);
        profile = await getAuthProfile(supabase);
        if (cancelled) return;
      }

      if (!profile) {
        try {
          const devRes = await fetch("/api/developer/session");
          if (devRes.ok) {
            const dev = await devRes.json();
            if (dev.actingClinicId) {
              sessionOkRef.current = true;
              portalIdRef.current = portal.loginPortalId;
              setReady(true);
              return;
            }
          }
        } catch {
          /* ignore */
        }

        const { data } = await getSession(supabase);
        const userId = data.session?.user?.id;
        if (userId && (await acceptCachedProfile(userId))) {
          return;
        }

        if (sessionOkRef.current) {
          setReady(true);
          return;
        }

        if (!(await hasLocalAuthSession(supabase))) {
          sessionOkRef.current = false;
          portalIdRef.current = null;
          router.replace(`/login?portal=${portal.loginPortalId}`);
          return;
        }

        sessionOkRef.current = false;
        setReady(true);
        return;
      }

      if (!isRoleAllowedForPath(profile.role, pathname)) {
        sessionOkRef.current = false;
        portalIdRef.current = null;
        setReady(false);
        await signOutUser(supabase);
        router.replace(
          `/login?portal=${portal.loginPortalId}&reason=role_mismatch`
        );
        return;
      }

      sessionOkRef.current = true;
      portalIdRef.current = portal.loginPortalId;
      setReady(true);
    }

    void enforce(!samePortalSession);

    const {
      data: { subscription },
    } = onAuthStateChange(supabase, (event) => {
      if (isBrowserOffline() && sessionOkRef.current) {
        setReady(true);
        return;
      }

      if (event === "SIGNED_OUT") {
        void (async () => {
          if (await hasLocalAuthSession(supabase)) {
            const refreshed = await refreshAuthSession(supabase);
            if (refreshed || sessionOkRef.current) {
              sessionOkRef.current = true;
              setReady(true);
              return;
            }
            const { data } = await getSession(supabase);
            const userId = data.session?.user?.id;
            if (userId && (await acceptCachedProfile(userId))) {
              return;
            }
            if (sessionOkRef.current) {
              setReady(true);
              return;
            }
          }
          sessionOkRef.current = false;
          portalIdRef.current = null;
          void enforce(true);
        })();
        return;
      }

      if (
        event === "SIGNED_IN" ||
        event === "TOKEN_REFRESHED" ||
        event === "INITIAL_SESSION"
      ) {
        if (!sessionOkRef.current) {
          void enforce(false);
        }
      }
    });

    const onAppResume = () => {
      if (cancelled || document.visibilityState !== "visible") return;
      const wasOk = sessionOkRef.current;

      void (async () => {
        await refreshAuthSession(supabase);
        if (cancelled) return;

        if (wasOk || sessionOkRef.current) {
          setReady(true);
          return;
        }

        if (await hasLocalAuthSession(supabase)) {
          const { data } = await getSession(supabase);
          const userId = data.session?.user?.id;
          if (userId && (await acceptCachedProfile(userId))) {
            return;
          }
          if (wasOk) {
            setReady(true);
            return;
          }
        }

        if (!sessionOkRef.current) {
          void enforce(false);
        }
      })();
    };

    document.addEventListener("visibilitychange", onAppResume);
    window.addEventListener("pageshow", onAppResume);
    window.addEventListener("focus", onAppResume);

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onAppResume);
      window.removeEventListener("pageshow", onAppResume);
      window.removeEventListener("focus", onAppResume);
    };
  }, [pathname, router]);

  if (!ready) return null;
  return <>{children}</>;
}
