import { cookies } from "next/headers";
import {
  createServerAuthClientFromAnySession,
  createServerAuthClient,
} from "@/lib/supabase/create-auth-client";
import { getAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/auth-helpers";
import { resolvePortalFromRequest } from "@/lib/auth/api-portal";

type CookieStore = {
  getAll: () => { name: string; value: string }[];
  setAll: (
    cookiesToSet: { name: string; value: string; options?: object }[]
  ) => void;
};

async function getCookieStore(): Promise<CookieStore> {
  const cookieStore = await cookies();
  return {
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
  };
}

export async function createApiSessionClient(req?: Request) {
  const store = await getCookieStore();
  const portalId = resolvePortalFromRequest(req);

  if (portalId) {
    const client = createServerAuthClient(store, portalId);
    const user = await getCurrentUser(client);
    if (user) return client;
  }

  return createServerAuthClientFromAnySession(store);
}

export async function getApiSessionUser(req?: Request) {
  const supabase = await createApiSessionClient(req);
  return getCurrentUser(supabase);
}

export async function getApiCallerProfile(req?: Request) {
  const user = await getApiSessionUser(req);
  if (!user) return null;

  const supabase = await createApiSessionClient(req);
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

export {
  authPortalHeaders,
  isApiDoctorRole,
  isApiStaffRole,
  resolvePortalFromRequest,
} from "@/lib/auth/api-portal";
