import { cookies } from "next/headers";
import {
  createServerAuthClientFromAnySession,
  createServerAuthClient,
} from "@/lib/supabase/create-auth-client";
import { getAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/auth-helpers";
import { resolvePortalFromRequest } from "@/lib/auth/api-portal";
import {
  loadPlatformAdminProfile,
  overlayActingClinic,
  resolveDeveloperActingClinicId,
} from "@/lib/auth/developer-impersonation";

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

// Several helpers resolve the session for the same request — reuse one client so
// Supabase Auth (getUser network call) is hit once per request, not 2-3 times.
const sessionClientByRequest = new WeakMap<
  Request,
  ReturnType<typeof createApiSessionClientUncached>
>();
const callerProfileByRequest = new WeakMap<
  Request,
  ReturnType<typeof getApiCallerProfileUncached>
>();

export function createApiSessionClient(req?: Request) {
  if (!req) return createApiSessionClientUncached(req);
  const cached = sessionClientByRequest.get(req);
  if (cached) return cached;
  const promise = createApiSessionClientUncached(req);
  sessionClientByRequest.set(req, promise);
  promise.catch(() => sessionClientByRequest.delete(req));
  return promise;
}

async function createApiSessionClientUncached(req?: Request) {
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

export async function getApiActiveClinicId(req?: Request): Promise<string | null> {
  const actingClinicId = await resolveDeveloperActingClinicId(req);
  if (actingClinicId) return actingClinicId;

  if (req && "headers" in req) {
    const headerClinicId = (req as Request).headers
      .get("x-mcp-developer-clinic-id")
      ?.trim();
    if (headerClinicId) return headerClinicId;
  }

  const caller = await getApiCallerProfile(req);
  return caller?.clinic_id ?? null;
}

export function getApiCallerProfile(req?: Request) {
  if (!req) return getApiCallerProfileUncached(req);
  const cached = callerProfileByRequest.get(req);
  if (cached) return cached;
  const promise = getApiCallerProfileUncached(req);
  callerProfileByRequest.set(req, promise);
  promise.catch(() => callerProfileByRequest.delete(req));
  return promise;
}

async function getApiCallerProfileUncached(req?: Request) {
  const actingClinicId = await resolveDeveloperActingClinicId(req);
  const profileSelect = "id, role, clinic_id, full_name";
  const user = await getApiSessionUser(req);

  if (!user) {
    if (!actingClinicId) return null;
    try {
      const admin = getAdminClient();
      const platformProfile = await loadPlatformAdminProfile(admin);
      if (!platformProfile) return null;
      return overlayActingClinic(platformProfile, actingClinicId);
    } catch (err) {
      console.error("[getApiCallerProfile] impersonation profile failed:", err);
      return null;
    }
  }

  try {
    const supabase = await createApiSessionClient(req);
    const { data: rlsProfile } = await supabase
      .from("profiles")
      .select(profileSelect)
      .eq("id", user.id)
      .maybeSingle();

    if (rlsProfile) {
      return overlayActingClinic(rlsProfile, actingClinicId);
    }
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

    if (!profile) return null;
    return overlayActingClinic(profile, actingClinicId);
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
