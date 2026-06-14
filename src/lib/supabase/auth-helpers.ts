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

/**
 * Prefer validated user when online; fall back to local session when offline
 * or when the network/Supabase validation request fails (PWA offline UX).
 */
export async function getCurrentUser(
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

export async function signOutUser(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("[auth] signOut failed:", error.message);
  }
}

export async function getSession(supabase: SupabaseClient) {
  const auth = supabase.auth as {
    getSession: () => Promise<{
      data: { session: { user: AuthUser } | null };
    }>;
  };
  return auth.getSession();
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
