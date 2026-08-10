"use client";

import { portalIdFromPath } from "@/lib/auth/portal-access";
import { createClient, createClientForPortal } from "@/lib/supabase/client";
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

  // المالك يملك جلستين (admin + accountant) — الخروج من إحداهما يجب أن يمسح
  // الأخرى، وإلا بقي الجهاز مسجّلاً في البوابة الثانية بعد تسجيل الخروج.
  if (portalId === "admin" || portalId === "accountant") {
    const paired = portalId === "admin" ? "accountant" : "admin";
    await signOutUser(createClientForPortal(paired));
  }

  const loginPortal =
    portalId === "doctor"
      ? "doctor"
      : portalId === "assistant"
        ? "assistant"
        : portalId === "admin"
          ? "admin"
          : "accountant";

  router.push(`/login?portal=${loginPortal}`);
  router.refresh();
}
