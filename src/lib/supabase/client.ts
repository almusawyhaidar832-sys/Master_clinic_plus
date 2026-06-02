import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  portalIdFromPath,
  type AuthPortalId,
} from "@/lib/auth/portal-access";
import { createBrowserAuthClient } from "@/lib/supabase/create-auth-client";

/**
 * Browser Supabase client scoped to the current portal path.
 * Each portal (/doctor, /dashboard, /admin) uses its own auth storage key
 * so two accounts can stay signed in on the same browser.
 */
export function createClient(): SupabaseClient<Database> {
  const portalId =
    typeof window !== "undefined"
      ? portalIdFromPath(window.location.pathname)
      : null;
  return createBrowserAuthClient(portalId ?? "default");
}

/** Use on login forms so the session is stored under the correct portal key */
export function createClientForPortal(
  portalId: AuthPortalId
): SupabaseClient<Database> {
  return createBrowserAuthClient(portalId);
}
