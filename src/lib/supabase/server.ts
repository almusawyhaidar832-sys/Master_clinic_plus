import { cookies, headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loginPortalToAuthPortalId,
  MCP_AUTH_PORTAL_HEADER,
  portalIdFromPath,
  type AuthPortalId,
} from "@/lib/auth/portal-access";
import { createServerAuthClient } from "@/lib/supabase/create-auth-client";

function resolvePortalId(pathHint?: string | null): AuthPortalId | "default" {
  if (pathHint) {
    const fromLogin = loginPortalToAuthPortalId(pathHint);
    if (fromLogin) return fromLogin;
    const fromPath = portalIdFromPath(pathHint);
    if (fromPath) return fromPath;
  }
  return "default";
}

export async function createClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const portalHint =
    headerStore.get(MCP_AUTH_PORTAL_HEADER) ??
    headerStore.get("x-pathname") ??
    headerStore.get("next-url");

  const portalId = resolvePortalId(portalHint);

  return createServerAuthClient(
    {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Server Component — ignore
        }
      },
    },
    portalId
  );
}
