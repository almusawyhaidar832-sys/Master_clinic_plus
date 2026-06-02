import { createBrowserClient, createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
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

const browserClients = new Map<string, SupabaseClient<Database>>();

export function createBrowserAuthClient(
  portalId: AuthPortalId | "default" = "default"
): SupabaseClient<Database> {
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
  ) as SupabaseClient<Database>;

  browserClients.set(storageKey, client);
  return client;
}

export function createServerAuthClient(
  cookieStore: CookieStore,
  portalId: AuthPortalId | "default" = "default"
): SupabaseClient<Database> {
  const storageKey = authStorageKeyForPortal(portalId);
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { name: storageKey },
      cookies: cookieStore,
    }
  ) as SupabaseClient<Database>;
}

/** API routes: find whichever portal session cookie is active */
export async function createServerAuthClientFromAnySession(
  cookieStore: CookieStore
): Promise<SupabaseClient<Database>> {
  for (const storageKey of allAuthStorageKeys()) {
    const client = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookieOptions: { name: storageKey },
        cookies: cookieStore,
      }
    ) as SupabaseClient<Database>;

    const {
      data: { user },
    } = await client.auth.getUser();
    if (user) return client;
  }

  return createServerAuthClient(cookieStore, "default");
}
