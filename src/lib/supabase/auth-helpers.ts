import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

type AuthUser = { id: string; email?: string };

type AuthApi = {
  getUser: () => Promise<{ data: { user: AuthUser | null }; error: Error | null }>;
  getSession: () => Promise<{
    data: { session: { user: AuthUser } | null };
    error: Error | null;
  }>;
};

async function getSessionUser(supabase: SupabaseClient): Promise<AuthUser | null> {
  const auth = supabase.auth as AuthApi;
  const { data } = await auth.getSession();
  return data.session?.user ?? null;
}

async function fetchCurrentUserUncached(
  supabase: SupabaseClient
): Promise<AuthUser | null> {
  const auth = supabase.auth as AuthApi;
  const offline =
    typeof navigator !== "undefined" && navigator.onLine === false;

  if (offline) {
    return getSessionUser(supabase);
  }

  try {
    const { data, error } = await auth.getUser();
    if (!error && data.user) return data.user;
    return getSessionUser(supabase);
  } catch {
    try {
      return getSessionUser(supabase);
    } catch {
      return null;
    }
  }
}

// Several components/hooks call getCurrentUser independently within the same
// render burst (e.g. on portal navigation). Coalesce those into a single
// network round-trip for a very short window instead of changing any result —
// after the window elapses, a fresh request is made exactly like before.
const CURRENT_USER_DEDUPE_MS = 2_000;
const currentUserCache = new WeakMap<
  SupabaseClient,
  { promise: Promise<AuthUser | null>; at: number }
>();

/**
 * Prefer validated user when online; fall back to local session when offline
 * or when the network/Supabase validation request fails (PWA offline UX).
 */
export async function getCurrentUser(
  supabase: SupabaseClient
): Promise<AuthUser | null> {
  const now = Date.now();
  const cached = currentUserCache.get(supabase);
  if (cached && now - cached.at < CURRENT_USER_DEDUPE_MS) {
    return cached.promise;
  }

  const promise = fetchCurrentUserUncached(supabase);
  currentUserCache.set(supabase, { promise, at: now });
  return promise;
}

type SignOutScope = "local" | "global" | "others";

/**
 * Sign out — defaults to `local` so logging in/out on one device does not
 * terminate sessions on other phones or computers (Supabase default is global).
 */
export async function signOutUser(
  supabase: SupabaseClient,
  scope: SignOutScope = "local"
): Promise<void> {
  const auth = supabase.auth as {
    signOut: (opts?: { scope: SignOutScope }) => Promise<{ error: { message: string } | null }>;
  };
  const { error } = await auth.signOut({ scope });
  if (error) {
    console.error("[auth] signOut failed:", error.message);
  }
}

/** Sign out from every device — use only when the user explicitly requests it */
export async function signOutUserEverywhere(
  supabase: SupabaseClient
): Promise<void> {
  await signOutUser(supabase, "global");
}

export async function getSession(supabase: SupabaseClient) {
  const auth = supabase.auth as {
    getSession: () => Promise<{
      data: { session: { user: AuthUser } | null };
    }>;
  };
  return auth.getSession();
}

/** Local session only — no network validation (PWA resume / offline) */
export async function hasLocalAuthSession(
  supabase: SupabaseClient
): Promise<boolean> {
  try {
    const { data } = await getSession(supabase);
    return Boolean(data.session?.user);
  } catch {
    return false;
  }
}

export async function signInWithPassword(
  supabase: SupabaseClient,
  email: string,
  password: string
) {
  const auth = supabase.auth as {
    signInWithPassword: (opts: {
      email: string;
      password: string;
    }) => Promise<{
      data: { user: AuthUser | null; session: unknown };
      error: { message: string } | null;
    }>;
  };
  return auth.signInWithPassword({ email, password });
}

/** Service-role admin API (createUser, deleteUser, …) */
/** Verify credentials the same way the login page does (anon signInWithPassword). */
export async function verifyPasswordSignIn(
  email: string,
  password: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return { ok: false, reason: "Supabase غير مضبوط" };
  }

  const client = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    return { ok: false, reason: error.message };
  }
  await client.auth.signOut({ scope: "local" });
  return { ok: true };
}

export function getAuthAdmin(supabase: SupabaseClient) {
  return (
    supabase.auth as {
      admin: {
        createUser: (opts: Record<string, unknown>) => Promise<{
          data: { user: AuthUser | null };
          error: { message: string } | null;
        }>;
        deleteUser: (id: string) => Promise<{ error: { message: string } | null }>;
        updateUserById: (
          id: string,
          attrs: Record<string, unknown>
        ) => Promise<{
          data: { user: AuthUser | null };
          error: { message: string } | null;
        }>;
        getUserById: (id: string) => Promise<{
          data: { user: (AuthUser & { email?: string }) | null };
          error: { message: string } | null;
        }>;
      };
    }
  ).admin;
}

export async function refreshAuthSession(
  supabase: SupabaseClient
): Promise<boolean> {
  try {
    const auth = supabase.auth as {
      refreshSession: () => Promise<{ error: { message: string } | null }>;
    };
    const { error } = await auth.refreshSession();
    return !error;
  } catch {
    return false;
  }
}

export function onAuthStateChange(
  supabase: SupabaseClient,
  callback: (event: string, session: unknown) => void
) {
  const auth = supabase.auth as {
    onAuthStateChange: (
      cb: (event: string, session: unknown) => void
    ) => { data: { subscription: { unsubscribe: () => void } } };
  };
  return auth.onAuthStateChange(callback);
}
