"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getAuthProfile } from "@/lib/clinic-context";
import { onAuthStateChange, signOutUser } from "@/lib/supabase/auth-helpers";
import {
  getAuthPortalForPath,
  isRoleAllowedForPath,
} from "@/lib/auth/portal-access";
import { isBrowserOffline } from "@/lib/offline-cache";

/**
 * Client guard: if session role does not match the current portal path,
 * sign out immediately and send user to the correct login card.
 *
 * Performance: after first successful check within a portal, keep the UI visible
 * while re-validating on in-portal navigation (avoids blank flash between pages).
 */
export function PortalAuthGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const sessionOkRef = useRef(false);
  const portalIdRef = useRef<string | null>(null);

  useEffect(() => {
    const portal = getAuthPortalForPath(pathname);
    if (!portal) {
      sessionOkRef.current = false;
      portalIdRef.current = null;
      setReady(true);
      return;
    }

    const supabase = createClient();
    let cancelled = false;

    const samePortalSession =
      sessionOkRef.current && portalIdRef.current === portal.loginPortalId;

    async function enforce(hideWhileChecking: boolean) {
      if (
        isBrowserOffline() &&
        sessionOkRef.current &&
        portalIdRef.current === portal.loginPortalId
      ) {
        setReady(true);
        return;
      }

      if (hideWhileChecking) {
        setReady(false);
      }

      const profile = await getAuthProfile(supabase);
      if (cancelled) return;

      if (!profile) {
        try {
          const devRes = await fetch("/api/developer/session");
          if (devRes.ok) {
            const dev = await devRes.json();
            if (dev.actingClinicId) {
              sessionOkRef.current = true;
              portalIdRef.current = portal!.loginPortalId;
              setReady(true);
              return;
            }
          }
        } catch {
          /* ignore */
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
          `/login?portal=${portal!.loginPortalId}&reason=role_mismatch`
        );
        return;
      }

      sessionOkRef.current = true;
      portalIdRef.current = portal!.loginPortalId;
      setReady(true);
    }

    void enforce(!samePortalSession);

    const {
      data: { subscription },
    } = onAuthStateChange(supabase, () => {
      if (isBrowserOffline() && sessionOkRef.current) {
        setReady(true);
        return;
      }
      sessionOkRef.current = false;
      void enforce(true);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [pathname, router]);

  if (!ready) return null;
  return <>{children}</>;
}
