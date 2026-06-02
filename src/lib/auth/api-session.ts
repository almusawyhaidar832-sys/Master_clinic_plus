import { cookies } from "next/headers";
import { createServerAuthClientFromAnySession } from "@/lib/supabase/create-auth-client";
import { getAdminClient } from "@/lib/supabase/admin";

export async function createApiSessionClient() {
  const cookieStore = await cookies();
  return createServerAuthClientFromAnySession({
    getAll: () => cookieStore.getAll(),
    setAll: (cookiesToSet) => {
      try {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options)
        );
      } catch {
        // ignore
      }
    },
  });
}

export async function getApiSessionUser() {
  const supabase = await createApiSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function getApiCallerProfile() {
  const user = await getApiSessionUser();
  if (!user) return null;

  const admin = getAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, role, clinic_id, full_name")
    .eq("id", user.id)
    .maybeSingle();

  return profile;
}
