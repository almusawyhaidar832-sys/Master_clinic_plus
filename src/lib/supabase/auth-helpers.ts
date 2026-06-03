import type { SupabaseClient } from "@supabase/supabase-js";

type AuthUser = { id: string; email?: string };

/** Workaround: @supabase/ssr narrows auth types and omits getUser in strict builds */
export async function getCurrentUser(
  supabase: SupabaseClient
): Promise<AuthUser | null> {
  const auth = supabase.auth as {
    getUser: () => Promise<{ data: { user: AuthUser | null }; error: Error | null }>;
  };
  const { data, error } = await auth.getUser();
  if (error) return null;
  return data.user;
}

export async function signOutUser(supabase: SupabaseClient): Promise<void> {
  const auth = supabase.auth as { signOut: () => Promise<void> };
  await auth.signOut();
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
