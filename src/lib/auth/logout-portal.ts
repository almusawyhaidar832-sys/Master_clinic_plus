"use client";

import { portalIdFromPath } from "@/lib/auth/portal-access";
import { createClient } from "@/lib/supabase/client";
import { signOutUser } from "@/lib/supabase/auth-helpers";

/** مسح جلسة البوابة الحالية والعودة لصفحة الدخول */
export async function logoutFromCurrentPortal(
  router: { push: (url: string) => void; refresh: () => void }
): Promise<void> {
  const pathname =
    typeof window !== "undefined" ? window.location.pathname : "";
  const portalId = portalIdFromPath(pathname);
  const supabase = createClient();
  await signOutUser(supabase);

  const loginPortal =
    portalId === "doctor"
      ? "doctor"
      : portalId === "admin"
        ? "admin"
        : "accountant";

  router.push(`/login?portal=${loginPortal}`);
  router.refresh();
}
