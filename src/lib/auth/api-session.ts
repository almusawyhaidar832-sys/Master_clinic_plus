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

    // Legacy: session stored under default cookie before portal-scoped keys
    const legacy = createServerAuthClient(store, "default");
    const legacyUser = await getCurrentUser(legacy);
    if (legacyUser) return legacy;
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

  const profileSelect = "id, role, clinic_id, full_name";

  try {
    const supabase = await createApiSessionClient(req);
    const { data: rlsProfile } = await supabase
      .from("profiles")
      .select(profileSelect)
      .eq("id", user.id)
      .maybeSingle();

    if (rlsProfile) return rlsProfile;
  } catch (err) {
    console.error("[getApiCallerProfile] RLS profile read failed:", err);
  }

  try {
    const admin = getAdminClient();
    const { data: profile, error } = await admin
      .from("profiles")
      .select(profileSelect)
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      console.error("[getApiCallerProfile] admin profile read failed:", error.message);
      return null;
    }

    return profile;
  } catch (err) {
    console.error("[getApiCallerProfile] admin client failed:", err);
    return null;
  }
}

export {
  authPortalHeaders,
  isApiAssistantRole,
  isApiDoctorRole,
  isApiStaffRole,
  resolvePortalFromRequest,
} from "@/lib/auth/api-portal";
