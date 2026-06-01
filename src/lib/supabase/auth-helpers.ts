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
