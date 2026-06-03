import { createBrowserClient, createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database.types";
import type { AppSupabaseClient } from "@/lib/supabase/app-client";
import { getCurrentUser } from "@/lib/supabase/auth-helpers";
import {
  allAuthStorageKeys,
  authStorageKeyForPortal,
  type AuthPortalId,
} from "@/lib/auth/portal-access";

type CookieStore = {
  getAll: () => { name: string; value: string }[];
  setAll: (
    cookies: { name: string; value: string; options?: object }[]
  ) => void;
};

const browserClients = new Map<string, AppSupabaseClient>();

export function createBrowserAuthClient(
  portalId: AuthPortalId | "default" = "default"
): AppSupabaseClient {
  const storageKey = authStorageKeyForPortal(portalId);
  const cached = browserClients.get(storageKey);
  if (cached) return cached;

  const client = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      isSingleton: false,
      cookieOptions: { name: storageKey },
    }
  );

  browserClients.set(storageKey, client as unknown as AppSupabaseClient);
  return client as unknown as AppSupabaseClient;
}

export function createServerAuthClient(
  cookieStore: CookieStore,
  portalId: AuthPortalId | "default" = "default"
): AppSupabaseClient {
  const storageKey = authStorageKeyForPortal(portalId);
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { name: storageKey },
      cookies: cookieStore,
    }
  ) as unknown as AppSupabaseClient;
}

/** API routes: find whichever portal session cookie is active */
export async function createServerAuthClientFromAnySession(
  cookieStore: CookieStore
): Promise<AppSupabaseClient> {
  for (const storageKey of allAuthStorageKeys()) {
    const client = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookieOptions: { name: storageKey },
        cookies: cookieStore,
      }
    );

    const user = await getCurrentUser(client as unknown as AppSupabaseClient);
    if (user) return client as unknown as AppSupabaseClient;
  }

  return createServerAuthClient(cookieStore, "default");
}
