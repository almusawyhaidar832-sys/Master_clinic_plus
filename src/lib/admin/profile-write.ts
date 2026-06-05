import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthAdmin } from "@/lib/supabase/auth-helpers";

export function isUsernameColumnMissing(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("username") &&
    (m.includes("schema cache") ||
      m.includes("could not find") ||
      m.includes("column"))
  );
}

export function usernameFromAuthEmail(email: string | undefined | null): string | null {
  const e = email?.trim().toLowerCase() ?? "";
  if (!e.endsWith("@masterclinic.local")) return null;
  const name = e.slice(0, -"@masterclinic.local".length);
  return name || null;
}

/** قراءة username — من profiles أو من بريد Auth الداخلي */
export async function readProfileUsername(
  admin: SupabaseClient,
  profileId: string
): Promise<string | null> {
  const { data, error } = await admin
    .from("profiles")
    .select("username")
    .eq("id", profileId)
    .maybeSingle();

  if (!error && data?.username) {
    return String(data.username);
  }

  if (error && !isUsernameColumnMissing(error.message)) {
    return null;
  }

  const authAdmin = getAuthAdmin(admin) as {
    getUserById: (id: string) => Promise<{
      data: { user: { email?: string } | null };
      error: { message: string } | null;
    }>;
  };

  const { data: authData } = await authAdmin.getUserById(profileId);
  return usernameFromAuthEmail(authData.user?.email);
}

export async function insertProfileRow(
  admin: SupabaseClient,
  payload: Record<string, unknown>
): Promise<{ error: string | null }> {
  const first = await admin.from("profiles").insert(payload);
  if (!first.error) return { error: null };

  if (isUsernameColumnMissing(first.error.message)) {
    const { username: _drop, ...withoutUsername } = payload;
    void _drop;
    const retry = await admin.from("profiles").insert(withoutUsername);
    return { error: retry.error?.message ?? null };
  }

  return { error: first.error.message };
}

export async function updateProfileRow(
  admin: SupabaseClient,
  profileId: string,
  payload: Record<string, unknown>
): Promise<{ error: string | null }> {
  const first = await admin
    .from("profiles")
    .update(payload)
    .eq("id", profileId);
  if (!first.error) return { error: null };

  if (isUsernameColumnMissing(first.error.message)) {
    const { username: _drop, ...withoutUsername } = payload;
    void _drop;
    if (Object.keys(withoutUsername).length === 0) {
      return { error: null };
    }
    const retry = await admin
      .from("profiles")
      .update(withoutUsername)
      .eq("id", profileId);
    return { error: retry.error?.message ?? null };
  }

  return { error: first.error.message };
}

/** فحص تكرار username — يتخطى إن لم يكن العمود موجوداً */
export async function isUsernameTaken(
  admin: SupabaseClient,
  username: string,
  excludeProfileId?: string
): Promise<boolean> {
  let q = admin.from("profiles").select("id").eq("username", username);
  if (excludeProfileId) q = q.neq("id", excludeProfileId);
  const { data, error } = await q.maybeSingle();

  if (error) {
    if (isUsernameColumnMissing(error.message)) return false;
    return false;
  }
  return Boolean(data?.id);
}
