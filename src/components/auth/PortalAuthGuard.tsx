"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getAuthProfile } from "@/lib/clinic-context";
import { onAuthStateChange, signOutUser } from "@/lib/supabase/auth-helpers";
import {
  getAuthPortalForPath,
  isRoleAllowedForPath,
} from "@/lib/auth/portal-access";

/**
 * Client guard: if session role does not match the current portal path,
 * sign out immediately and send user to the correct login card.
 */
export function PortalAuthGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const portal = getAuthPortalForPath(pathname);
    if (!portal) {
      setReady(true);
      return;
    }

    const supabase = createClient();
    let cancelled = false;

    async function enforce() {
      const profile = await getAuthProfile(supabase);
      if (cancelled) return;

      if (!profile) {
        setReady(true);
        return;
      }

      if (!isRoleAllowedForPath(profile.role, pathname)) {
        await signOutUser(supabase);
        router.replace(
          `/login?portal=${portal!.loginPortalId}&reason=role_mismatch`
        );
        return;
      }

      setReady(true);
    }

    setReady(false);
    enforce();

    const {
      data: { subscription },
    } = onAuthStateChange(supabase, () => {
      enforce();
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [pathname, router]);

  if (!ready) return null;
  return <>{children}</>;
}
