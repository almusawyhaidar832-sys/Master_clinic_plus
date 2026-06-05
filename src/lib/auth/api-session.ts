import { cookies } from "next/headers";
import { createServerAuthClientFromAnySession } from "@/lib/supabase/create-auth-client";
import { getAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/auth-helpers";

export async function createApiSessionClient() {
  const cookieStore = await cookies();
  return createServerAuthClientFromAnySession({
    getAll: () => cookieStore.getAll(),
    setAll: (cookiesToSet: { name: string; value: string; options?: object }[]) => {
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
  return getCurrentUser(supabase);
}

export async function getApiCallerProfile() {
  const user = await getApiSessionUser();
  if (!user) return null;

  const supabase = await createApiSessionClient();
  const admin = getAdminClient();

  let { data: profile } = await admin
    .from("profiles")
    .select("id, role, clinic_id, full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (profile && !profile.clinic_id) {
    await supabase.rpc("link_profile_to_first_clinic");
    const refetch = await admin
      .from("profiles")
      .select("id, role, clinic_id, full_name")
      .eq("id", user.id)
      .maybeSingle();
    profile = refetch.data ?? profile;
  }

  return profile;
}
